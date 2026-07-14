"use strict";

// Candidate selection and distance sorting are independent for every blast.
// A small pool of these workers removes the largest 10 Gt detonation spike
// from the render thread while the physics worker advances rigid bodies.
let generation = 0;
let buildings = new Float32Array(0);

function prepareBlast(message) {
  const matches = [];
  const px = message.position[0];
  const py = message.position[1];
  const pz = message.position[2];
  const radiusSq = message.radius * message.radius;
  for (let offset = 0; offset < buildings.length; offset += 4) {
    const dx = buildings[offset + 1] - px;
    const dy = buildings[offset + 2] - py;
    const dz = buildings[offset + 3] - pz;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq <= radiusSq) matches.push([buildings[offset], Math.sqrt(distanceSq)]);
  }
  matches.sort((a, b) => a[1] - b[1]);

  const physicalStride = Math.max(1, Math.ceil(matches.length / message.physicalLimit));
  const physical = [];
  const visualPool = [];
  for (let index = 0; index < matches.length; index++) {
    if (index % physicalStride === 0 && physical.length < message.physicalLimit) physical.push(matches[index]);
    else visualPool.push(matches[index]);
  }
  const visualStride = Math.max(1, Math.ceil(visualPool.length / message.visualLimit));
  const visual = [];
  for (let index = 0; index < visualPool.length && visual.length < message.visualLimit; index += visualStride) visual.push(visualPool[index]);

  const physicalData = new Float32Array(physical.length * 2);
  const visualData = new Float32Array(visual.length * 2);
  physical.forEach((entry, index) => { physicalData[index * 2] = entry[0]; physicalData[index * 2 + 1] = entry[1]; });
  visual.forEach((entry, index) => { visualData[index * 2] = entry[0]; visualData[index * 2 + 1] = entry[1]; });
  postMessage({
    type: "blastPrepared", generation, blastId: message.blastId,
    physicalBuffer: physicalData.buffer, visualBuffer: visualData.buffer,
    candidateCount: matches.length
  }, [physicalData.buffer, visualData.buffer]);
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === "init") {
    generation = message.generation;
    buildings = new Float32Array(message.buffer);
    postMessage({ type: "initialized", generation, buildingCount: buildings.length / 4 });
    return;
  }
  if (message.type === "prepareBlast" && message.generation === generation) prepareBlast(message);
};

postMessage({ type: "ready" });
