"use strict";

// Cannon runs in a dedicated worker when the sandbox is served over HTTP.
// Rendering, camera input and smoke stay on the main thread, so rigid-body
// collision work can occupy another CPU core without blocking WebGL frames.
importScripts("https://cdn.jsdelivr.net/npm/cannon@0.6.2/build/cannon.min.js");

let world = null;
let concrete = null;
let generation = 0;
const bodies = new Map();
const dynamicIds = new Set();
const STATIC_GROUP = 1;
const BUILDING_GROUP = 2;
const RUBBLE_GROUP = 4;

function resetWorld(nextGeneration) {
  generation = nextGeneration;
  bodies.clear();
  dynamicIds.clear();
  world = new CANNON.World();
  world.gravity.set(0, -9.81, 0);
  world.allowSleep = true;
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 8;
  world.solver.tolerance = .0015;
  world.quatNormalizeSkip = 0;
  world.quatNormalizeFast = true;

  concrete = new CANNON.Material("concrete");
  world.addContactMaterial(new CANNON.ContactMaterial(concrete, concrete, {
    friction: .72,
    restitution: .035,
    contactEquationStiffness: 8e7,
    contactEquationRelaxation: 3
  }));
  world.defaultContactMaterial.friction = .72;
  world.defaultContactMaterial.restitution = .035;

  const ground = new CANNON.Body({ mass: 0, material: concrete });
  ground.collisionFilterGroup = STATIC_GROUP;
  ground.collisionFilterMask = BUILDING_GROUP | RUBBLE_GROUP;
  ground.addShape(new CANNON.Plane());
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);
}

function makeBoxBody(message, mass) {
  const size = message.size;
  const body = new CANNON.Body({
    mass,
    material: concrete,
    shape: new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2))
  });
  body.position.set(message.position[0], message.position[1], message.position[2]);
  body.linearDamping = message.type === "addBuilding" ? .22 : .18;
  body.angularDamping = message.type === "addBuilding" ? .34 : .24;
  body.allowSleep = true;
  body.sleepSpeedLimit = message.type === "addBuilding" ? .14 : .2;
  body.sleepTimeLimit = 1.4;
  body._simulationKind = message.type === "addBuilding" ? "building" : "rubble";
  body.collisionFilterGroup = body._simulationKind === "building" ? BUILDING_GROUP : RUBBLE_GROUP;
  body.collisionFilterMask = STATIC_GROUP;
  body._originalY = message.position[1];
  body._height = size[1];
  world.addBody(body);
  bodies.set(message.id, body);
  return body;
}

function clampBuildingMotion(body) {
  // A shock front can overturn or slide a massive structure. It cannot launch
  // the complete building like light debris; only the separate rubble bodies
  // are allowed a positive ballistic arc.
  body.velocity.y = Math.min(body.velocity.y, .35);
  const horizontal = Math.hypot(body.velocity.x, body.velocity.z);
  if (horizontal > 22) {
    const scale = 22 / horizontal;
    body.velocity.x *= scale;
    body.velocity.z *= scale;
  }
  const angular = Math.hypot(body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z);
  if (angular > 2.5) {
    const scale = 2.5 / angular;
    body.angularVelocity.x *= scale;
    body.angularVelocity.y *= scale;
    body.angularVelocity.z *= scale;
  }
  const highestPlausibleCenter = body._originalY + Math.max(1, body._height * .08);
  if (body.position.y > highestPlausibleCenter) {
    body.position.y = highestPlausibleCenter;
    body.velocity.y = Math.min(0, body.velocity.y);
  }
}

function sendTransforms() {
  const active = [];
  for (const id of dynamicIds) {
    const body = bodies.get(id);
    if (!body) continue;
    const sleeping = body.sleepState === CANNON.Body.SLEEPING;
    if (!sleeping || body._sentSleeping !== true) active.push([id, body]);
    body._sentSleeping = sleeping;
  }
  const result = new Float32Array(active.length * 8);
  let offset = 0;
  for (const [id, body] of active) {
    result[offset++] = id;
    result[offset++] = body.position.x;
    result[offset++] = body.position.y;
    result[offset++] = body.position.z;
    result[offset++] = body.quaternion.x;
    result[offset++] = body.quaternion.y;
    result[offset++] = body.quaternion.z;
    result[offset++] = body.quaternion.w;
  }
  const buffer = offset === result.length ? result.buffer : result.slice(0, offset).buffer;
  postMessage({ type: "transforms", generation, buffer, dynamicCount: dynamicIds.size, activeCount: active.length }, [buffer]);
}

function applyCommand(message) {
  if (message.type === "addBuilding") {
    makeBoxBody(message, 0);
  } else if (message.type === "activateBuilding") {
    const body = bodies.get(message.id);
    if (!body) return;
    body.type = CANNON.Body.DYNAMIC;
    body.mass = message.mass;
    body.updateMassProperties();
    body.aabbNeedsUpdate = true;
    body._sentSleeping = false;
    body.wakeUp();
    dynamicIds.add(message.id);
  } else if (message.type === "impulse") {
    const body = bodies.get(message.id);
    if (!body) return;
    body.applyImpulse(new CANNON.Vec3(message.impulse[0], message.impulse[1], message.impulse[2]), new CANNON.Vec3(message.point[0], message.point[1], message.point[2]));
    body.angularVelocity.x += message.angular[0];
    body.angularVelocity.y += message.angular[1];
    body.angularVelocity.z += message.angular[2];
    body._sentSleeping = false;
    body.wakeUp();
  } else if (message.type === "addRubble") {
    const body = makeBoxBody(message, message.mass);
    body.velocity.set(message.velocity[0], message.velocity[1], message.velocity[2]);
    body.angularVelocity.set(message.angular[0], message.angular[1], message.angular[2]);
    dynamicIds.add(message.id);
  } else if (message.type === "removeBody") {
    const body = bodies.get(message.id);
    if (body) world.removeBody(body);
    bodies.delete(message.id);
    dynamicIds.delete(message.id);
  }
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === "reset") {
    resetWorld(message.generation);
    return;
  }
  if (!world || message.generation !== generation) return;

  if (message.type === "addBuildings") {
    const records = new Float32Array(message.buffer);
    for (let offset = 0; offset < records.length; offset += 7) applyCommand({
      type: "addBuilding", id: Math.round(records[offset]),
      size: [records[offset + 1], records[offset + 2], records[offset + 3]],
      position: [records[offset + 4], records[offset + 5], records[offset + 6]]
    });
  } else if (message.type === "batch") {
    for (const command of message.commands) applyCommand(command);
  } else if (message.type === "addBuilding" || message.type === "activateBuilding" || message.type === "impulse" || message.type === "addRubble" || message.type === "removeBody") {
    applyCommand(message);
  } else if (message.type === "step") {
    if (!dynamicIds.size) {
      postMessage({ type: "transforms", generation, buffer: new ArrayBuffer(0), dynamicCount: 0, activeCount: 0 });
      return;
    }
    world.step(1 / 60, Math.max(.001, Math.min(.05, message.delta)), 3);
    for (const id of dynamicIds) {
      const body = bodies.get(id);
      if (body && body._simulationKind === "building") clampBuildingMotion(body);
    }
    sendTransforms();
  }
};

postMessage({ type: "ready" });
