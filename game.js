(() => {
  "use strict";

  if (!window.THREE) {
    document.body.innerHTML = "<p style='color:white;padding:30px'>Three.js 未加载，请检查网络或刷新页面。</p>";
    return;
  }

  const T = window.THREE;
  const C = window.CANNON;
  if (!C) {
    document.body.innerHTML = "<p style='color:white;padding:30px'>Cannon 物理引擎未加载，请检查网络或刷新页面。</p>";
    return;
  }
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, amount) => a + (b - a) * amount;
  const smoothstep = (a, b, value) => {
    const t = clamp((value - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
  const easeOutExpo = (t) => t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(t));
  const formatTimeline = (seconds) => `T+00:${String(Math.floor(seconds)).padStart(2, "0")}.${String(Math.floor(seconds % 1 * 100)).padStart(2, "0")}`;

  function randomGenerator(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6d2b79f5;
      let t = value;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const stage = $("#simulationStage");
  const canvas = $("#simCanvas");
  const grainCanvas = $("#grainCanvas");
  const grainCtx = grainCanvas.getContext("2d");
  const waveCanvas = $("#waveCanvas");
  const waveCtx = waveCanvas.getContext("2d");

  const ui = {
    yieldRange: $("#yieldRange"), yieldOutput: $("#yieldOutput"),
    heightRange: $("#heightRange"), heightOutput: $("#heightOutput"), burstDescription: $("#burstDescription"),
    intervalRange: $("#intervalRange"), intervalOutput: $("#intervalOutput"), continuousToggle: $("#continuousToggle"),
    sequenceState: $("#sequenceState"), detonateBtn: $("#detonateBtn"), detonateText: $("#detonateText"), detonateHint: $("#detonateHint"),
    targetRadius: $("#targetRadius"), predictedRadius: $("#predictedRadius"), predictionState: $("#predictionState"),
    systemStatus: $("#systemStatus"), sceneLabel: $("#sceneLabel"), windLabel: $("#windLabel"), whiteFlash: $("#whiteFlash"),
    timecode: $("#timecode"), pauseBtn: $("#pauseBtn"), clearBtn: $("#replayBtn"), speedBtn: $("#speedBtn"),
    timelineTime: $("#timelineTime"), timelineProgress: $("#timelineProgress"), phaseLabel: $("#phaseLabel"), blastCounter: $("#blastCounter"),
    phaseNumber: $("#phaseNumber"), phaseName: $("#phaseName"), phaseSub: $("#phaseSub"), signalState: $("#signalState"),
    fireballMetric: $("#fireballMetric"), shockMetric: $("#shockMetric"), cloudMetric: $("#cloudMetric"), seismicMetric: $("#seismicMetric"),
    fireballBar: $("#fireballBar"), shockBar: $("#shockBar"), cloudBar: $("#cloudBar"), seismicBar: $("#seismicBar"),
    integrityValue: $("#integrityValue"), integrityBar: $("#integrityBar"), integrityNote: $("#integrityNote"),
    logList: $("#logList"), eventBanner: $("#eventBanner"), eventKicker: $("#eventKicker"), eventTitle: $("#eventTitle"), eventTime: $("#eventTime"),
    audioBtn: $("#audioBtn"), helpBtn: $("#helpBtn"), helpDialog: $("#helpDialog"), groundLabel: $("#groundLabel")
  };

  const environments = {
    city: { label: "都市沙盘", skyTop: new T.Color("#17252b"), skyBottom: new T.Color("#c39a6b"), fog: 0x344341, ground: 0x171c1b, wind: 12 },
    desert: { label: "荒漠沙盘", skyTop: new T.Color("#21343b"), skyBottom: new T.Color("#d5a968"), fog: 0x6d5944, ground: 0x403327, wind: 26 },
    coast: { label: "海岸沙盘", skyTop: new T.Color("#142e3b"), skyBottom: new T.Color("#a4aea0"), fog: 0x355968, ground: 0x17292c, wind: 18 }
  };

  const phases = [
    { at: 0, number: "01", name: "强光脉冲", sub: "RADIANT FLASH", title: "初始闪光" },
    { at: .18, number: "02", name: "火球膨胀", sub: "FIREBALL EXPANSION", title: "三维火球膨胀" },
    { at: .85, number: "03", name: "冲击扩散", sub: "SHOCK FRONT", title: "环形冲击波扩散" },
    { at: 2.2, number: "04", name: "云柱上升", sub: "CONVECTIVE COLUMN", title: "高温云柱上升" },
    { at: 6.2, number: "05", name: "云冠展开", sub: "MUSHROOM CAP", title: "蘑菇云冠成形" },
    { at: 13, number: "06", name: "尘埃残留", sub: "RESIDUAL DUST", title: "残余尘埃扩散" }
  ];

  const state = {
    yieldKt: 100,
    burstHeight: 650,
    environment: "city",
    continuous: false,
    sequenceActive: false,
    interval: 2.5,
    nextBlastAt: 0,
    worldTime: 0,
    speed: 1,
    paused: false,
    totalBlasts: 0,
    blasts: [],
    scars: [],
    latestBlast: null,
    phaseIndex: -1,
    lastFrame: performance.now(),
    targetPoint: new T.Vector3(0, 0, 0),
    keys: new Set(),
    dragging: false,
    dragged: false,
    dragStartX: 0,
    dragStartY: 0,
    lastPointerX: 0,
    lastPointerY: 0,
    audioEnabled: true,
    audioUnlocked: false,
    audioUnlockPromise: null,
    audioContext: null,
    masterGain: null,
    audioCompressor: null,
    audioReverb: null,
    audioAnalyser: null,
    audioMeterData: null,
    audioMeterPeak: 0,
    audioCache: null,
    audioVoices: [],
    ambientAudio: null,
    buildings: [],
    activeBuildings: [],
    buildingSpatial: new Map(),
    cityChunks: [],
    rubble: [],
    rubbleBatches: [],
    physicsWorld: null,
    physicsMaterial: null,
    physicsWorker: null,
    physicsWorkerEnabled: false,
    physicsWorkerReady: false,
    physicsWorkerFailed: false,
    physicsStepPending: false,
    physicsObjects: new Map(),
    physicsCommandQueue: [],
    physicsAccumulator: 0,
    physicsGeneration: 0,
    nextPhysicsId: 0,
    effectWorkers: [],
    effectWorkerCursor: 0,
    effectWorkersFailed: false,
    hardwareConcurrency: Math.max(2, navigator.hardwareConcurrency || 4),
    seed: 204,
    camera: { target: new T.Vector3(0, 320, 0), radius: 850, theta: .68, phi: 1.22 },
    renderScale: Math.min(window.devicePixelRatio || 1, 1.5),
    performanceFrames: 0,
    performanceLast: performance.now(),
    lastFps: 60,
    animationFrame: 0,
    uiLast: 0,
    chunkCullX: Number.NaN,
    chunkCullZ: Number.NaN,
    visibleCityChunks: 0,
    dimensions: { width: 1, height: 1, dpr: 1 }
  };

  function createWorkerBody(position, mass = 0) {
    return {
      id: ++state.nextPhysicsId,
      mass,
      position: { x: position.x, y: position.y, z: position.z },
      quaternion: { x: 0, y: 0, z: 0, w: 1 }
    };
  }

  function withPhysicsMode(label) {
    const effectCount = state.effectWorkers.filter((entry) => entry.ready && entry.generation === state.physicsGeneration).length;
    const workerCount = (state.physicsWorkerReady ? 1 : 0) + effectCount;
    canvas.dataset.workerCount = String(workerCount);
    return workerCount ? `${label} · ${workerCount} WORKERS` : label;
  }

  function handlePhysicsWorkerMessage(event) {
    const message = event.data || {};
    if (message.type === "ready") {
      state.physicsWorkerReady = true;
      if (!state.blasts.length && !state.sequenceActive) ui.systemStatus.textContent = withPhysicsMode("3D SANDBOX READY");
      return;
    }
    if (message.type !== "transforms" || message.generation !== state.physicsGeneration) return;
    state.physicsStepPending = false;
    canvas.dataset.physicsBodies = String(message.dynamicCount || 0);
    canvas.dataset.physicsActive = String(message.activeCount || 0);
    const transforms = new Float32Array(message.buffer);
    const dirtyBatches = new Set();
    for (let index = 0; index < transforms.length; index += 8) {
      const id = Math.round(transforms[index]);
      const object = state.physicsObjects.get(id);
      if (!object) continue;
      const body = object.body;
      body.position.x = transforms[index + 1]; body.position.y = transforms[index + 2]; body.position.z = transforms[index + 3];
      body.quaternion.x = transforms[index + 4]; body.quaternion.y = transforms[index + 5]; body.quaternion.z = transforms[index + 6]; body.quaternion.w = transforms[index + 7];
      if (object.kind === "building") {
        const building = object.building;
        building.position.set(body.position.x, body.position.y, body.position.z);
        if (building.mesh) {
          building.mesh.position.copy(building.position);
          building.mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
        }
      } else if (object.item) {
        const item = object.item;
        item.position.set(body.position.x, body.position.y, body.position.z);
        item.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
        updateRubbleInstance(item);
        dirtyBatches.add(item.batch);
      }
    }
    dirtyBatches.forEach((batch) => { batch.mesh.instanceMatrix.needsUpdate = true; });
  }

  function applyPreparedBlast(message) {
    if (message.generation !== state.physicsGeneration) return;
    const blast = state.blasts.find((item) => item.id === message.blastId);
    if (!blast) return;
    blast.physicalImpacts = new Float32Array(message.physicalBuffer);
    blast.visualImpacts = new Float32Array(message.visualBuffer);
    blast.candidateCount = message.candidateCount || 0;
    blast.candidatesPending = false;
    const physicalBuildings = [];
    for (let index = 0; index < blast.physicalImpacts.length; index += 2) {
      const building = state.buildings[Math.round(blast.physicalImpacts[index])];
      if (building) physicalBuildings.push(building);
    }
    blast.integrityBuildings = physicalBuildings;
    canvas.dataset.blastCandidates = String(blast.candidateCount);
  }

  function handleEffectWorkerMessage(entry, event) {
    const message = event.data || {};
    if (message.type === "ready") {
      entry.ready = true;
      return;
    }
    if (message.type === "initialized") {
      entry.generation = message.generation;
      canvas.dataset.effectWorkers = String(state.effectWorkers.filter((item) => item.generation === state.physicsGeneration).length);
      if (!state.blasts.length && !state.sequenceActive) ui.systemStatus.textContent = withPhysicsMode("3D SANDBOX READY");
      return;
    }
    if (message.type === "blastPrepared") applyPreparedBlast(message);
  }

  function startEffectWorkers() {
    if (!window.Worker || location.protocol === "file:") return;
    const count = state.hardwareConcurrency >= 8 ? 2 : 1;
    for (let index = 0; index < count; index++) {
      try {
        const entry = { worker: new Worker("effects-worker.js"), ready: false, generation: -1 };
        entry.worker.onmessage = (event) => handleEffectWorkerMessage(entry, event);
        entry.worker.onerror = (event) => {
          console.warn("Effects Worker unavailable; using main-thread candidate preparation.", event.message || event);
          entry.ready = false; entry.generation = -1;
          state.effectWorkersFailed = true;
        };
        state.effectWorkers.push(entry);
      } catch (error) {
        console.warn("Effects Worker could not start.", error);
        state.effectWorkersFailed = true;
      }
    }
  }

  function startPhysicsWorker() {
    if (!window.Worker || location.protocol === "file:") return;
    try {
      const worker = new Worker("physics-worker.js");
      state.physicsWorker = worker;
      state.physicsWorkerEnabled = true;
      worker.onmessage = handlePhysicsWorkerMessage;
      worker.onerror = (event) => {
        console.warn("Physics Worker unavailable; reverting to main-thread physics.", event.message || event);
        if (state.physicsWorkerFailed) return;
        state.physicsWorkerFailed = true;
        state.physicsWorkerEnabled = false;
        state.physicsWorkerReady = false;
        state.physicsStepPending = false;
        state.physicsObjects.clear();
        worker.terminate();
        state.physicsWorker = null;
        setTimeout(clearSandbox, 0);
      };
    } catch (error) {
      console.warn("Physics Worker could not start; using main-thread physics.", error);
    }
  }

  startPhysicsWorker();
  startEffectWorkers();

  const renderer = new T.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(state.renderScale);
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  canvas.dataset.gpuPipeline = renderer.capabilities.isWebGL2 ? "webgl2-batched" : "webgl1-batched";

  const scene = new T.Scene();
  scene.fog = new T.FogExp2(environments.city.fog, .000085);
  // A practical near plane is critical on this 21 km scene. The old .1 / 40000
  // ratio caused coplanar roads, blast scars and terrain to flicker at distance.
  const camera = new T.PerspectiveCamera(48, 1, 1.5, 40000);
  const raycaster = new T.Raycaster();
  const pointer = new T.Vector2();
  const cameraForward = new T.Vector3();
  const cameraRight = new T.Vector3();
  const cameraMove = new T.Vector3();
  const cameraWorldPosition = new T.Vector3();
  const blastCenter = new T.Vector3();
  const audioForward = new T.Vector3();
  const audioUp = new T.Vector3();
  let worldGroup = new T.Group();
  let effectsGroup = new T.Group();
  scene.add(worldGroup, effectsGroup);

  const hemi = new T.HemisphereLight(0xb9d3d0, 0x2b241d, 1.15);
  scene.add(hemi);
  const sun = new T.DirectionalLight(0xffd7a0, 1.45);
  sun.position.set(-70, 110, 45);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -520; sun.shadow.camera.right = 520; sun.shadow.camera.top = 520; sun.shadow.camera.bottom = -520; sun.shadow.camera.far = 1800;
  scene.add(sun, sun.target);

  function createSky() {
    const material = new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      uniforms: { topColor: { value: environments[state.environment].skyTop }, bottomColor: { value: environments[state.environment].skyBottom }, blastGlow: { value: 0 } },
      vertexShader: "varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "uniform vec3 topColor; uniform vec3 bottomColor; uniform float blastGlow; varying vec3 vPos; void main(){ float h=normalize(vPos).y*.5+.5; vec3 c=mix(bottomColor,topColor,smoothstep(.05,.86,h)); c+=vec3(1.0,.24,.04)*blastGlow*(1.0-h)*.35; gl_FragColor=vec4(c,1.0); }"
    });
    const mesh = new T.Mesh(new T.SphereGeometry(28000, 40, 22), material);
    mesh.name = "sky";
    return mesh;
  }

  function radialTexture(kind) {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const c2 = c.getContext("2d");
    const gradient = c2.createRadialGradient(64, 64, 1, 64, 64, 62);
    if (kind === "smoke") {
      gradient.addColorStop(0, "rgba(255,255,255,.96)");
      gradient.addColorStop(.35, "rgba(255,255,255,.7)");
      gradient.addColorStop(.75, "rgba(255,255,255,.2)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
    } else if (kind === "spark") {
      gradient.addColorStop(0, "rgba(255,255,255,1)"); gradient.addColorStop(.12, "rgba(255,210,90,.95)"); gradient.addColorStop(.5, "rgba(255,70,10,.35)"); gradient.addColorStop(1, "rgba(255,30,0,0)");
    } else {
      gradient.addColorStop(0, "rgba(255,255,230,1)"); gradient.addColorStop(.16, "rgba(255,190,55,.85)"); gradient.addColorStop(.45, "rgba(255,67,10,.3)"); gradient.addColorStop(1, "rgba(255,30,0,0)");
    }
    c2.fillStyle = gradient; c2.fillRect(0, 0, size, size);
    const texture = new T.CanvasTexture(c);
    texture.minFilter = T.LinearFilter;
    return texture;
  }

  const textures = {
    smoke: radialTexture("smoke"), spark: radialTexture("spark"), glow: radialTexture("glow")
  };
  const particleColor = new T.Color();
  const particleBlack = new T.Color(0x000000);
  const particleEmber = new T.Color(0xff8a24);

  function buildingTexture(seed, warm = false) {
    const random = randomGenerator(seed);
    const c = document.createElement("canvas");
    c.width = 96; c.height = 192;
    const c2 = c.getContext("2d");
    c2.fillStyle = warm ? "#1d1c19" : "#172022"; c2.fillRect(0, 0, c.width, c.height);
    for (let y = 9; y < 188; y += 15) {
      for (let x = 7; x < 92; x += 13) {
        const lit = random() > .72;
        c2.fillStyle = lit ? `rgba(222,${145 + random() * 55},72,${.32 + random() * .28})` : "rgba(2,7,8,.62)";
        c2.fillRect(x, y, 5, 6);
      }
    }
    const texture = new T.CanvasTexture(c);
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  const buildingMaterials = [11, 29, 47, 83].map((seed, index) => {
    const map = buildingTexture(seed, index > 2);
    return new T.MeshStandardMaterial({ map, emissiveMap: map, emissive: new T.Color(index > 2 ? 0x513018 : 0x263735), emissiveIntensity: .3, color: new T.Color(index % 2 ? 0x64706c : 0x4d5c5b), roughness: .92, metalness: .04 });
  });

  let groundPlane = null;
  let targetMarker = null;
  const buildingUnitGeometry = new T.BoxGeometry(1, 1, 1);
  const instanceDummy = new T.Object3D();
  const hiddenMatrix = new T.Matrix4().makeScale(0, 0, 0);
  const rubbleGeometry = new T.BoxGeometry(1, 1, 1);
  const rubbleMaterials = [
    new T.MeshStandardMaterial({ color: 0x3a403d, roughness: .94 }),
    new T.MeshStandardMaterial({ color: 0x282d2c, roughness: .98 }),
    new T.MeshStandardMaterial({ color: 0x52483b, roughness: .96 })
  ];

  function resetPhysics() {
    state.rubble = [];
    state.rubbleBatches = [];
    state.physicsStepPending = false;
    state.physicsAccumulator = 0;
    state.physicsCommandQueue = [];
    state.physicsObjects.clear();
    state.nextPhysicsId = 0;
    state.physicsGeneration++;
    if (state.physicsWorkerEnabled) {
      state.physicsWorld = null;
      state.physicsMaterial = null;
      state.physicsWorker.postMessage({ type: "reset", generation: state.physicsGeneration });
      return;
    }
    const world = new C.World();
    world.gravity.set(0, -9.81, 0);
    world.allowSleep = true;
    world.broadphase = new C.SAPBroadphase(world);
    world.solver.iterations = 9;
    world.solver.tolerance = .001;
    const material = new C.Material("concrete");
    const contact = new C.ContactMaterial(material, material, { friction: .72, restitution: .045, contactEquationStiffness: 8e7, contactEquationRelaxation: 3 });
    world.addContactMaterial(contact);
    world.defaultContactMaterial.friction = .72;
    world.defaultContactMaterial.restitution = .035;
    const groundBody = new C.Body({ mass: 0, material });
    groundBody.collisionFilterGroup = 1;
    groundBody.collisionFilterMask = 2 | 4;
    groundBody.addShape(new C.Plane());
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(groundBody);
    state.physicsWorld = world;
    state.physicsMaterial = material;
  }

  const BUILDING_CELL = 320;
  function spatialKey(x, z) { return `${Math.floor(x / BUILDING_CELL)},${Math.floor(z / BUILDING_CELL)}`; }
  function registerBuilding(building) {
    building.userData.index = state.buildings.length;
    state.buildings.push(building);
    const key = spatialKey(building.position.x, building.position.z);
    if (!state.buildingSpatial.has(key)) state.buildingSpatial.set(key, []);
    state.buildingSpatial.get(key).push(building);
  }
  function queryBuildings(position, radius) {
    const results = [];
    const minX = Math.floor((position.x - radius) / BUILDING_CELL), maxX = Math.floor((position.x + radius) / BUILDING_CELL);
    const minZ = Math.floor((position.z - radius) / BUILDING_CELL), maxZ = Math.floor((position.z + radius) / BUILDING_CELL);
    const radiusSq = radius * radius;
    for (let cz = minZ; cz <= maxZ; cz++) for (let cx = minX; cx <= maxX; cx++) {
      const cell = state.buildingSpatial.get(`${cx},${cz}`);
      if (!cell) continue;
      for (const building of cell) {
        const dx = building.position.x - position.x, dz = building.position.z - position.z;
        if (dx * dx + dz * dz <= radiusSq) results.push(building);
      }
    }
    return results;
  }

  function prepareBlastCandidatesMain(blast, radius, physicalLimit, visualLimit) {
    const matches = queryBuildings(blast.position, radius).map((building) => {
      const dx = building.position.x - blast.position.x;
      const dy = building.position.y - blast.originY;
      const dz = building.position.z - blast.position.z;
      return [building.userData.index, Math.hypot(dx, dy, dz)];
    }).sort((a, b) => a[1] - b[1]);
    const physicalStride = Math.max(1, Math.ceil(matches.length / physicalLimit));
    const physical = [];
    const visualPool = [];
    matches.forEach((entry, index) => {
      if (index % physicalStride === 0 && physical.length < physicalLimit) physical.push(entry);
      else visualPool.push(entry);
    });
    const visualStride = Math.max(1, Math.ceil(visualPool.length / visualLimit));
    const visual = [];
    for (let index = 0; index < visualPool.length && visual.length < visualLimit; index += visualStride) visual.push(visualPool[index]);
    const physicalData = new Float32Array(physical.length * 2);
    const visualData = new Float32Array(visual.length * 2);
    physical.forEach((entry, index) => { physicalData[index * 2] = entry[0]; physicalData[index * 2 + 1] = entry[1]; });
    visual.forEach((entry, index) => { visualData[index * 2] = entry[0]; visualData[index * 2 + 1] = entry[1]; });
    applyPreparedBlast({
      type: "blastPrepared", generation: state.physicsGeneration, blastId: blast.id,
      physicalBuffer: physicalData.buffer, visualBuffer: visualData.buffer, candidateCount: matches.length
    });
  }

  function requestBlastCandidates(blast, radius, physicalLimit, visualLimit) {
    const readyWorkers = state.effectWorkers.filter((entry) => entry.ready && entry.generation === state.physicsGeneration);
    if (!readyWorkers.length) {
      prepareBlastCandidatesMain(blast, radius, physicalLimit, visualLimit);
      return;
    }
    const entry = readyWorkers[state.effectWorkerCursor++ % readyWorkers.length];
    entry.worker.postMessage({
      type: "prepareBlast", generation: state.physicsGeneration, blastId: blast.id,
      position: [blast.position.x, blast.originY, blast.position.z], radius, physicalLimit, visualLimit
    });
    canvas.dataset.candidateCompute = "worker";
  }

  function ensureBuildingBody(building) {
    const data = building.userData;
    if (data.body) return data.body;
    ensureBuildingBodies([building]);
    return data.body;
  }

  function ensureBuildingBodies(buildings) {
    const workerRecords = [];
    for (const building of buildings) {
      const data = building.userData;
      if (data.body) continue;
    if (state.physicsWorkerEnabled) {
      const body = createWorkerBody(building.position);
      data.body = body;
      state.physicsObjects.set(body.id, { kind: "building", building, body });
        workerRecords.push(body.id, data.width, data.height, data.depth, building.position.x, building.position.y, building.position.z);
        continue;
    }
    const body = new C.Body({ mass: 0, material: state.physicsMaterial });
    body.addShape(new C.Box(new C.Vec3(data.width / 2, data.height / 2, data.depth / 2)));
      body.collisionFilterGroup = 2;
      body.collisionFilterMask = 1;
    body.position.set(building.position.x, building.position.y, building.position.z);
    body.linearDamping = .22; body.angularDamping = .34; body.allowSleep = true; body.sleepSpeedLimit = .14; body.sleepTimeLimit = 1.4;
    state.physicsWorld.addBody(body);
    data.body = body;
    }
    if (workerRecords.length) {
      const records = new Float32Array(workerRecords);
      state.physicsWorker.postMessage({ type: "addBuildings", generation: state.physicsGeneration, buffer: records.buffer }, [records.buffer]);
    }
  }

  function queuePhysicsCommand(command) {
    if (state.physicsWorkerEnabled) state.physicsCommandQueue.push(command);
  }

  function flushPhysicsCommands() {
    if (!state.physicsWorkerEnabled || !state.physicsCommandQueue.length) return;
    const commands = state.physicsCommandQueue;
    state.physicsCommandQueue = [];
    state.physicsWorker.postMessage({ type: "batch", generation: state.physicsGeneration, commands });
    canvas.dataset.physicsBatch = String(commands.length);
  }

  function groundMesh(geometry, material, x, z, rotationZ = 0, y = .8) {
    const mesh = new T.Mesh(geometry, material);
    mesh.rotation.set(-Math.PI / 2, 0, rotationZ);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    worldGroup.add(mesh);
    return mesh;
  }

  function riverCenterAt(x) {
    return 3000 + Math.sin(x * .00062) * 235 + Math.sin(x * .00147 + .8) * 92;
  }

  function riverHalfWidthAt(x) {
    return 155 + Math.sin(x * .00113 + 1.7) * 32 + Math.sin(x * .00231) * 18;
  }

  function createRiverGeometry(bankExtra = 0) {
    const shape = new T.Shape();
    const northBank = [], southBank = [];
    const samples = 96;
    for (let index = 0; index <= samples; index++) {
      const x = lerp(-9600, 9600, index / samples);
      const center = riverCenterAt(x), halfWidth = riverHalfWidthAt(x) + bankExtra;
      // groundMesh rotates XY into XZ, which flips local Y into world Z.
      northBank.push(new T.Vector2(x, -(center + halfWidth)));
      southBank.push(new T.Vector2(x, -(center - halfWidth)));
    }
    shape.moveTo(northBank[0].x, northBank[0].y);
    northBank.slice(1).forEach((point) => shape.lineTo(point.x, point.y));
    southBank.reverse().forEach((point) => shape.lineTo(point.x, point.y));
    shape.closePath();
    return new T.ShapeGeometry(shape);
  }

  function districtLabel(text, x, z) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 64;
    const c2 = c.getContext("2d");
    c2.fillStyle = "rgba(5,10,11,.72)"; c2.fillRect(0, 4, 256, 56);
    c2.strokeStyle = "rgba(255,176,52,.72)"; c2.strokeRect(2, 6, 252, 52);
    c2.fillStyle = "#ffb034"; c2.font = "600 24px Arial"; c2.textAlign = "center"; c2.fillText(text, 128, 40);
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false }));
    sprite.position.set(x, 92, z); sprite.scale.set(74, 18, 1);
    worldGroup.add(sprite);
  }

  function addMapDetails(districts, random) {
    const roadMaterial = new T.MeshStandardMaterial({ color: 0x101716, roughness: .94, metalness: .03, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const lineMaterial = new T.MeshBasicMaterial({ color: 0xc0a76c, transparent: true, opacity: .46, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const parkMaterial = new T.MeshStandardMaterial({ color: state.environment === "desert" ? 0x4d4932 : 0x1d382b, roughness: 1 });
    const roadGeometry = new T.PlaneGeometry(470, 12);
    const lineGeometry = new T.PlaneGeometry(450, .45);
    const roadCount = districts.length * 10;
    const roads = new T.InstancedMesh(roadGeometry, roadMaterial, roadCount);
    const lines = new T.InstancedMesh(lineGeometry, lineMaterial, roadCount);
    let roadIndex = 0;
    for (const district of districts) {
      for (let lane = -2; lane <= 2; lane++) {
        const offset = lane * 72;
        instanceDummy.position.set(district.x, 1.1, district.z + offset); instanceDummy.rotation.set(-Math.PI / 2, 0, 0); instanceDummy.scale.set(1, 1, 1); instanceDummy.updateMatrix(); roads.setMatrixAt(roadIndex, instanceDummy.matrix);
        instanceDummy.position.y = 1.45; instanceDummy.updateMatrix(); lines.setMatrixAt(roadIndex, instanceDummy.matrix); roadIndex++;
        instanceDummy.position.set(district.x + offset, 1.1, district.z); instanceDummy.rotation.set(-Math.PI / 2, 0, Math.PI / 2); instanceDummy.updateMatrix(); roads.setMatrixAt(roadIndex, instanceDummy.matrix);
        instanceDummy.position.y = 1.45; instanceDummy.updateMatrix(); lines.setMatrixAt(roadIndex, instanceDummy.matrix); roadIndex++;
      }
      if (district.index % 2 === 1) groundMesh(new T.PlaneGeometry(92, 92), parkMaterial, district.x, district.z, 0, .72);
      districtLabel(`DISTRICT ${String(district.index + 1).padStart(2, "0")}`, district.x, district.z);
    }
    roads.receiveShadow = true; roads.instanceMatrix.needsUpdate = true; lines.instanceMatrix.needsUpdate = true;
    worldGroup.add(roads, lines);

    const transitMaterial = new T.MeshStandardMaterial({ color: 0x0b1112, roughness: .9 });
    groundMesh(new T.PlaneGeometry(19000, 34), transitMaterial, 0, 0, 0, .92);
    groundMesh(new T.PlaneGeometry(19000, 34), transitMaterial, 0, 0, Math.PI / 2, .92);

    const bankMaterial = new T.MeshStandardMaterial({ color: state.environment === "desert" ? 0x463b2e : 0x1d2927, roughness: 1 });
    groundMesh(createRiverGeometry(72), bankMaterial, 0, 0, 0, .74);
    const waterColor = state.environment === "desert" ? 0x342f28 : state.environment === "coast" ? 0x12303a : 0x122628;
    const waterMaterial = new T.MeshStandardMaterial({ color: waterColor, roughness: .86, metalness: .02, side: T.DoubleSide });
    groundMesh(createRiverGeometry(), waterMaterial, 0, 0, 0, .96);
    const bridgeMaterial = new T.MeshStandardMaterial({ color: 0x343b39, roughness: .8, metalness: .16 });
    [-6000, 0, 6000].forEach((x) => {
      const slope = (riverCenterAt(x + 20) - riverCenterAt(x - 20)) / 40;
      groundMesh(new T.PlaneGeometry(52, 560), bridgeMaterial, x, riverCenterAt(x), Math.atan(slope), 2.05);
    });

    const treeDistricts = districts.filter((district) => district.index % 2 === 1);
    const treeCount = treeDistricts.length * 44;
    const trunks = new T.InstancedMesh(new T.CylinderGeometry(.45, .62, 5, 6), new T.MeshStandardMaterial({ color: 0x3d3024, roughness: 1 }), treeCount);
    const crowns = new T.InstancedMesh(new T.ConeGeometry(2.5, 6.5, 8), new T.MeshStandardMaterial({ color: state.environment === "desert" ? 0x5f613d : 0x264d36, roughness: .96 }), treeCount);
    let treeIndex = 0;
    for (const district of treeDistricts) {
      for (let i = 0; i < 44; i++) {
        const angle = random() * Math.PI * 2, radius = 14 + random() * 35;
        const x = district.x + Math.cos(angle) * radius, z = district.z + Math.sin(angle) * radius;
        instanceDummy.position.set(x, 2.5, z); instanceDummy.rotation.set(0, random() * Math.PI, 0); instanceDummy.scale.setScalar(.75 + random() * .55); instanceDummy.updateMatrix(); trunks.setMatrixAt(treeIndex, instanceDummy.matrix);
        instanceDummy.position.y = 7; instanceDummy.updateMatrix(); crowns.setMatrixAt(treeIndex, instanceDummy.matrix); treeIndex++;
      }
    }
    trunks.castShadow = crowns.castShadow = true; trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true; worldGroup.add(trunks, crowns);

    const industrial = districts.filter((district) => district.index % 4 === 0);
    const tankCount = industrial.length * 12;
    const tanks = new T.InstancedMesh(new T.CylinderGeometry(6, 6, 9, 20), new T.MeshStandardMaterial({ color: 0x6f7874, roughness: .5, metalness: .42 }), tankCount);
    let tankIndex = 0;
    for (const district of industrial) {
      for (let i = 0; i < 12; i++) {
        instanceDummy.position.set(district.x - 145 + (i % 4) * 22, 4.5, district.z + 105 + Math.floor(i / 4) * 23); instanceDummy.rotation.set(0,0,0); instanceDummy.scale.setScalar(1); instanceDummy.updateMatrix(); tanks.setMatrixAt(tankIndex++, instanceDummy.matrix);
      }
    }
    tanks.castShadow = true; tanks.instanceMatrix.needsUpdate = true; worldGroup.add(tanks);

    const towerMaterial = new T.MeshStandardMaterial({ color: 0x68736f, roughness: .6, metalness: .55 });
    for (const district of districts) {
      const tower = new T.Group();
      const mast = new T.Mesh(new T.CylinderGeometry(.7, 1.2, 74, 8), towerMaterial); mast.position.y = 37;
      const beacon = new T.Mesh(new T.SphereGeometry(1.4, 10, 8), new T.MeshBasicMaterial({ color: 0xff4b2e })); beacon.position.y = 75;
      tower.add(mast, beacon); tower.position.set(district.x + 188, 0, district.z - 175); worldGroup.add(tower);
    }
  }

  function createTargetMarker() {
    const group = new T.Group();
    const ringMaterial = new T.MeshBasicMaterial({ color: 0xff5533, transparent: true, opacity: .82, side: T.DoubleSide, depthWrite: false });
    const ring = new T.Mesh(new T.RingGeometry(2.8, 3.05, 64), ringMaterial);
    ring.rotation.x = -Math.PI / 2; ring.position.y = .12;
    const crossGeometry = new T.BufferGeometry().setFromPoints([
      new T.Vector3(-4.5,.15,0), new T.Vector3(4.5,.15,0), new T.Vector3(0,.15,-4.5), new T.Vector3(0,.15,4.5)
    ]);
    const cross = new T.LineSegments(crossGeometry, new T.LineBasicMaterial({ color: 0xffb038, transparent: true, opacity: .75 }));
    const beam = new T.Mesh(new T.CylinderGeometry(.035,.035,16,6), new T.MeshBasicMaterial({ color: 0xff5c37, transparent: true, opacity: .22, blending: T.AdditiveBlending, depthWrite: false }));
    beam.position.y = 8;
    group.add(ring, cross, beam);
    group.userData.ring = ring;
    return group;
  }

  function initializeEffectWorkers() {
    if (!state.effectWorkers.length) return;
    const buildingData = new Float32Array(state.buildings.length * 4);
    state.buildings.forEach((building, index) => {
      building.userData.index = index;
      buildingData[index * 4] = index;
      buildingData[index * 4 + 1] = building.position.x;
      buildingData[index * 4 + 2] = building.position.y;
      buildingData[index * 4 + 3] = building.position.z;
    });
    for (const entry of state.effectWorkers) {
      const copy = buildingData.slice();
      entry.generation = -1;
      entry.worker.postMessage({ type: "init", generation: state.physicsGeneration, buffer: copy.buffer }, [copy.buffer]);
    }
  }

  function initRubbleBatches() {
    const capacity = 192;
    state.rubbleBatches = rubbleMaterials.map((material) => {
      const mesh = new T.InstancedMesh(rubbleGeometry, material, capacity);
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      effectsGroup.add(mesh);
      return { mesh, capacity, nextSlot: 0, freeSlots: [] };
    });
  }

  function allocateRubbleSlot(materialIndex) {
    const batch = state.rubbleBatches[materialIndex];
    if (!batch) return null;
    const slot = batch.freeSlots.length ? batch.freeSlots.pop() : batch.nextSlot++;
    if (slot >= batch.capacity) return null;
    batch.mesh.count = Math.max(batch.mesh.count, slot + 1);
    return { batch, slot };
  }

  function updateRubbleInstance(item) {
    instanceDummy.position.copy(item.position);
    instanceDummy.quaternion.copy(item.quaternion);
    instanceDummy.scale.copy(item.size);
    instanceDummy.updateMatrix();
    item.batch.mesh.setMatrixAt(item.slot, instanceDummy.matrix);
  }

  function releaseRubbleInstance(item) {
    item.batch.mesh.setMatrixAt(item.slot, hiddenMatrix);
    item.batch.mesh.instanceMatrix.needsUpdate = true;
    item.batch.freeSlots.push(item.slot);
  }

  function buildEnvironment() {
    scene.remove(worldGroup);
    worldGroup = new T.Group();
    scene.add(worldGroup);
    state.buildings = [];
    state.activeBuildings = [];
    state.buildingSpatial = new Map();
    state.cityChunks = [];
    state.chunkCullX = Number.NaN;
    state.chunkCullZ = Number.NaN;
    resetPhysics();
    initRubbleBatches();
    const environment = environments[state.environment];
    scene.fog.color.set(environment.fog);
    renderer.setClearColor(environment.fog, 1);
    worldGroup.add(createSky());

    const groundMaterial = new T.MeshStandardMaterial({ color: environment.ground, roughness: .96, metalness: state.environment === "coast" ? .22 : .02 });
    groundPlane = new T.Mesh(new T.PlaneGeometry(21000, 21000), groundMaterial);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.receiveShadow = true;
    groundPlane.name = "interactive-ground";
    worldGroup.add(groundPlane);

    const grid = new T.GridHelper(20000, 200, 0x65756f, 0x394541);
    grid.position.y = .42;
    grid.material.transparent = true; grid.material.opacity = state.environment === "desert" ? .1 : .19;
    worldGroup.add(grid);

    const random = randomGenerator(state.seed + (state.environment === "city" ? 10 : state.environment === "desert" ? 90 : 170));
    const districts = [];
    let districtIndex = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) districts.push({ x: dx * 6000, z: dz * 6000, index: districtIndex++ });
    addMapDetails(districts, random);

    const descriptors = [[], [], [], []];
    const rows = state.environment === "desert" ? 11 : 13;
    const columns = state.environment === "desert" ? 15 : 17;
    const spacingX = 23.5, spacingZ = 24.5;
    for (const district of districts) {
      for (let zi = 0; zi < rows; zi++) {
        for (let xi = 0; xi < columns; xi++) {
          if ((xi % 5 === 2) || (zi % 4 === 1)) continue;
          if (random() < (state.environment === "desert" ? .55 : .18)) continue;
          const localX = (xi - (columns - 1) / 2) * spacingX;
          const localZ = (zi - (rows - 1) / 2) * spacingZ;
          if (district.index % 2 === 1 && Math.abs(localX) < 56 && Math.abs(localZ) < 56) continue;
          const x = district.x + localX + (random() - .5) * 3;
          const z = district.z + localZ + (random() - .5) * 3;
          const heightScale = (state.environment === "desert" ? .48 : 1) * (district.index === 4 ? 1.3 : .82 + random() * .35);
          const width = 9 + random() * 9.5;
          const depth = 9 + random() * 9.5;
          let height = (11 + Math.pow(random(), 1.55) * 58) * heightScale;
          if (Math.abs(localX) < 30 && Math.abs(localZ) < 30) height *= .72;
          const materialIndex = Math.floor(random() * buildingMaterials.length);
          descriptors[materialIndex].push({ x, z, width, depth, height, materialIndex });
        }
      }
    }

    const cityStep = 55;
    const fillerChance = state.environment === "desert" ? .38 : state.environment === "coast" ? .64 : .76;
    let gridZ = 0;
    for (let z = -9700; z <= 9700; z += cityStep, gridZ++) {
      let gridX = 0;
      for (let x = -9700; x <= 9700; x += cityStep, gridX++) {
        if (gridX % 6 === 0 || gridZ % 6 === 0 || random() > fillerChance) continue;
        let insideDistrict = false;
        for (const district of districts) {
          if (Math.abs(x - district.x) < 285 && Math.abs(z - district.z) < 245) { insideDistrict = true; break; }
        }
        if (insideDistrict) continue;
        if (Math.abs(z - riverCenterAt(x)) < riverHalfWidthAt(x) + 55) continue;
        const width = 31 + random() * 17;
        const depth = 31 + random() * 17;
        const heightBase = state.environment === "desert" ? .46 : 1;
        const height = (9 + Math.pow(random(), 1.9) * 34) * heightBase;
        const materialIndex = Math.floor(random() * buildingMaterials.length);
        descriptors[materialIndex].push({ x: x + (random()-.5)*8, z: z + (random()-.5)*8, width, depth, height, materialIndex });
      }
    }

    // Split the full-map city into world-space chunks. Rendering one global
    // InstancedMesh forced every building through both color and shadow passes,
    // even when the camera could only see a few blocks.
    const cityChunkSize = 4000;
    const chunkMap = new Map();
    descriptors.forEach((list, materialIndex) => list.forEach((descriptor) => {
      const cellX = Math.floor(descriptor.x / cityChunkSize);
      const cellZ = Math.floor(descriptor.z / cityChunkSize);
      const key = `${cellX},${cellZ}`;
      if (!chunkMap.has(key)) chunkMap.set(key, {
        x: (cellX + .5) * cityChunkSize, z: (cellZ + .5) * cityChunkSize,
        materials: buildingMaterials.map(() => []), meshes: [], radius: cityChunkSize * .72
      });
      chunkMap.get(key).materials[materialIndex].push(descriptor);
    }));

    for (const chunk of chunkMap.values()) {
      const maxHeight = Math.max(1, ...chunk.materials.flat().map((descriptor) => descriptor.height));
      const chunkGeometry = buildingUnitGeometry.clone();
      chunkGeometry.boundingSphere = new T.Sphere(new T.Vector3(0, maxHeight * .5, 0), Math.hypot(chunk.radius, maxHeight));
      chunk.materials.forEach((list, materialIndex) => {
        if (!list.length) return;
        const instances = new T.InstancedMesh(chunkGeometry, buildingMaterials[materialIndex], list.length);
        instances.position.set(chunk.x, 0, chunk.z);
        // Dynamic wrecks still cast shadows. The tens of thousands of static
        // shells receive them but do not trigger a second full-city draw pass.
        instances.castShadow = false;
        instances.receiveShadow = true;
        instances.frustumCulled = true;
        instances.instanceMatrix.setUsage(T.DynamicDrawUsage);
        list.forEach((descriptor, instanceIndex) => {
          const { x, z, width, depth, height } = descriptor;
          instanceDummy.position.set(x - chunk.x, height / 2, z - chunk.z);
          instanceDummy.rotation.set(0, 0, 0);
          instanceDummy.scale.set(width, height, depth);
          instanceDummy.updateMatrix();
          instances.setMatrixAt(instanceIndex, instanceDummy.matrix);
          const building = {
            position: new T.Vector3(x, height / 2, z), material: buildingMaterials[materialIndex], instanceMesh: instances, instanceIndex, mesh: null,
            userData: {
              baseY: height / 2, height, width, depth, damage: 0, damageTarget: 0,
              originalX: x, originalZ: z, instanceOriginX: chunk.x, instanceOriginZ: chunk.z,
              body: null, activated: false, fragmented: false,
              visualTiltX: 0, visualTiltZ: 0, visualSink: 0
            }
          };
          registerBuilding(building);
        });
        instances.instanceMatrix.needsUpdate = true;
        chunk.meshes.push(instances);
        worldGroup.add(instances);
      });
      state.cityChunks.push(chunk);
    }

    initializeEffectWorkers();

    if (state.environment === "desert") {
      const dunes = new T.InstancedMesh(new T.SphereGeometry(1, 14, 7), new T.MeshStandardMaterial({ color: 0x6c563a, roughness: 1, transparent: true, opacity: .72 }), 64);
      for (let i = 0; i < 64; i++) { instanceDummy.position.set((random()-.5)*19000,-.6,(random()-.5)*19000); instanceDummy.rotation.set(0,random()*Math.PI,0); instanceDummy.scale.set(40+random()*110,2+random()*7,18+random()*55); instanceDummy.updateMatrix(); dunes.setMatrixAt(i,instanceDummy.matrix); }
      dunes.instanceMatrix.needsUpdate = true; worldGroup.add(dunes);
    }

    targetMarker = createTargetMarker();
    targetMarker.position.copy(state.targetPoint);
    worldGroup.add(targetMarker);
    updateAmbientAudioProfile();
  }

  const fireballVertex = `
    uniform float uTime;
    varying float vNoise;
    varying vec3 vNormalDir;
    varying vec3 vObjectPos;
    float n3(vec3 p){ return sin(p.x*3.1+uTime*2.2)*sin(p.y*4.3-uTime*1.7)*sin(p.z*3.7+uTime*1.3); }
    void main(){
      float n=n3(position)+.45*n3(position*2.17+2.3)+.2*n3(position*4.1-1.7);
      vec3 p=position*(1.0+n*.09);
      vNoise=n; vNormalDir=normalMatrix*normal; vObjectPos=position;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
    }`;
  const fireballFragment = `
    uniform float uTime; uniform float uOpacity;
    varying float vNoise; varying vec3 vNormalDir; varying vec3 vObjectPos;
    void main(){
      float fres=pow(1.0-abs(normalize(vNormalDir).z),1.6);
      float boiling=sin(vObjectPos.x*17.0+uTime*4.0)*sin(vObjectPos.y*13.0-uTime*3.1)*sin(vObjectPos.z*19.0+uTime*2.6);
      float heat=clamp(.68+vNoise*.34+boiling*.16,0.0,1.0);
      float cooling=smoothstep(.8,6.5,uTime);
      float crust=smoothstep(.18,.72,vNoise+boiling*.34+cooling*.38);
      vec3 white=vec3(1.0,.99,.82); vec3 yellow=vec3(1.0,.43,.025); vec3 red=vec3(.46,.025,.004);
      vec3 col=mix(red,yellow,smoothstep(.05,.62,heat)); col=mix(col,white,smoothstep(.62,1.0,heat));
      col=mix(col,vec3(.055,.018,.009),crust*cooling*.78);
      col+=vec3(1.0,.12,.01)*fres*.38;
      gl_FragColor=vec4(col,uOpacity*(.9-fres*.18));
    }`;

  const pressureShellVertex = `
    varying vec3 vViewNormal;
    varying vec3 vViewDir;
    void main(){
      vec4 mv=modelViewMatrix*vec4(position,1.0);
      vViewNormal=normalize(normalMatrix*normal);
      vViewDir=normalize(-mv.xyz);
      gl_Position=projectionMatrix*mv;
    }`;
  const pressureShellFragment = `
    uniform float uOpacity;
    varying vec3 vViewNormal;
    varying vec3 vViewDir;
    void main(){
      float rim=pow(1.0-abs(dot(normalize(vViewNormal),normalize(vViewDir))),1.35);
      float band=smoothstep(.08,.82,rim);
      vec3 color=mix(vec3(1.0,.38,.08),vec3(1.0,.96,.78),band);
      float alpha=uOpacity*(.12+band*.88);
      if(alpha<.004) discard;
      gl_FragColor=vec4(color,alpha);
    }`;

  function createParticleCloud(count, texture, blending = T.NormalBlending) {
    const geometry = new T.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    geometry.setAttribute("position", new T.BufferAttribute(positions, 3).setUsage(T.DynamicDrawUsage));
    geometry.setAttribute("color", new T.BufferAttribute(colors, 3).setUsage(T.DynamicDrawUsage));
    geometry.setAttribute("aSize", new T.BufferAttribute(sizes, 1).setUsage(T.DynamicDrawUsage));
    geometry.setAttribute("aAlpha", new T.BufferAttribute(alphas, 1).setUsage(T.DynamicDrawUsage));
    const material = new T.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uPixelRatio: { value: state.renderScale }, uOpacity: { value: 1 } },
      vertexShader: "attribute float aSize; attribute float aAlpha; varying vec3 vColor; varying float vAlpha; uniform float uPixelRatio; void main(){ vColor=color; vAlpha=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=aSize*uPixelRatio*(260.0/max(1.0,-mv.z)); gl_Position=projectionMatrix*mv; }",
      fragmentShader: "uniform sampler2D uMap; uniform float uOpacity; varying vec3 vColor; varying float vAlpha; void main(){ vec4 tex=texture2D(uMap,gl_PointCoord); gl_FragColor=vec4(vColor,tex.a*vAlpha*uOpacity); if(gl_FragColor.a<.008) discard; }",
      vertexColors: true, transparent: true, depthWrite: false, blending
    });
    const points = new T.Points(geometry, material);
    points.frustumCulled = false;
    points.userData = { count };
    return points;
  }

  function createSmokeVolume(count, giantYield = false) {
    const geometry = new T.SphereGeometry(1, giantYield ? 12 : 14, giantYield ? 8 : 10);
    const smokePositions = geometry.attributes.position;
    const smokeNormals = geometry.attributes.normal;
    for (let index = 0; index < smokePositions.count; index++) {
      const x = smokePositions.getX(index), y = smokePositions.getY(index), z = smokePositions.getZ(index);
      const warp = 1 + Math.sin(x * 7.1 + y * 3.7) * .11 + Math.sin(z * 8.3 - y * 5.2) * .075;
      const px = x * warp, py = y * warp, pz = z * warp;
      const normalLength = Math.max(.001, Math.hypot(px, py, pz));
      smokePositions.setXYZ(index, px, py, pz);
      smokeNormals.setXYZ(index, px / normalLength, py / normalLength, pz / normalLength);
    }
    smokePositions.needsUpdate = true;
    smokeNormals.needsUpdate = true;
    const material = new T.MeshLambertMaterial({
      color: 0xffffff, emissive: 0x030302, vertexColors: true, transparent: true,
      opacity: giantYield ? .68 : .64, depthWrite: false
    });
    const volume = new T.InstancedMesh(geometry, material, count);
    volume.instanceMatrix.setUsage(T.DynamicDrawUsage);
    volume.frustumCulled = false;
    for (let index = 0; index < count; index++) {
      instanceDummy.position.set(0, -10000, 0);
      instanceDummy.rotation.set(0, 0, 0);
      instanceDummy.scale.setScalar(0);
      instanceDummy.updateMatrix();
      volume.setMatrixAt(index, instanceDummy.matrix);
      volume.setColorAt(index, particleBlack);
    }
    volume.instanceMatrix.needsUpdate = true;
    volume.instanceColor.needsUpdate = true;
    return volume;
  }

  function setSmokeBlob(volume, index, x, y, z, size, color, stretchX, stretchY, rotation) {
    instanceDummy.position.set(x, y, z);
    instanceDummy.rotation.set(rotation * .43, rotation, rotation * .27);
    instanceDummy.scale.set(size * stretchX, size * stretchY, size / Math.max(.6, stretchX));
    instanceDummy.updateMatrix();
    volume.setMatrixAt(index, instanceDummy.matrix);
    volume.setColorAt(index, color);
  }

  function setParticle(points, index, x, y, z, color, size, alpha) {
    const position = points.geometry.attributes.position.array;
    const colors = points.geometry.attributes.color.array;
    const sizes = points.geometry.attributes.aSize.array;
    const alphas = points.geometry.attributes.aAlpha.array;
    const i3 = index * 3;
    position[i3] = x; position[i3 + 1] = y; position[i3 + 2] = z;
    colors[i3] = color.r; colors[i3 + 1] = color.g; colors[i3 + 2] = color.b;
    sizes[index] = size; alphas[index] = alpha;
  }

  function markParticleUpdate(points) {
    points.geometry.attributes.position.needsUpdate = true;
    points.geometry.attributes.color.needsUpdate = true;
    points.geometry.attributes.aSize.needsUpdate = true;
    points.geometry.attributes.aAlpha.needsUpdate = true;
  }

  function createBlast(position, automatic = false) {
    initAudio();
    const yieldKt = state.yieldKt;
    const heightMeters = state.burstHeight;
    const giantYield = yieldKt >= 1000000;
    const activeEffectLimit = giantYield ? 4 : yieldKt >= 10000 ? 6 : 10;
    while (state.blasts.length >= activeEffectLimit) {
      const retired = state.blasts.shift();
      removeBlast(retired);
    }
    if (giantYield && state.renderScale > .68) {
      state.renderScale = .68;
      resize();
    }
    if (giantYield) renderer.shadowMap.enabled = false;
    const strength = Math.pow(yieldKt / 100, .18);
    const originY = 4.5 + heightMeters;
    const group = new T.Group();
    group.position.copy(position);
    effectsGroup.add(group);

    const fireMaterial = new T.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } },
      vertexShader: fireballVertex, fragmentShader: fireballFragment,
      transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide
    });
    const fireball = new T.Mesh(new T.IcosahedronGeometry(1, giantYield ? 3 : 4), fireMaterial);
    fireball.position.y = originY;
    group.add(fireball);

    // The boiling shader is the outer photosphere. These nested 3D bodies fill
    // its interior so close/free-camera views never reveal an empty shell.
    const innerHeat = new T.Mesh(
      new T.SphereGeometry(1, giantYield ? 20 : 28, giantYield ? 12 : 18),
      new T.MeshBasicMaterial({ color: 0xff6b0b, transparent: true, opacity: .78, side: T.DoubleSide, blending: T.AdditiveBlending, depthWrite: false })
    );
    innerHeat.position.y = originY;
    const solidCore = new T.Mesh(
      new T.SphereGeometry(1, giantYield ? 20 : 28, giantYield ? 12 : 18),
      new T.MeshBasicMaterial({ color: 0xffffc7, transparent: true, opacity: 1, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending })
    );
    solidCore.position.y = originY;
    group.add(innerHeat, solidCore);

    const glow = new T.Sprite(new T.SpriteMaterial({ map: textures.glow, color: 0xff4d0d, transparent: true, opacity: .8, blending: T.AdditiveBlending, depthWrite: false }));
    glow.position.y = originY; group.add(glow);
    const hotCore = new T.Sprite(new T.SpriteMaterial({ map: textures.glow, color: 0xffffc2, transparent: true, opacity: 1, blending: T.AdditiveBlending, depthWrite: false }));
    hotCore.position.y = originY; group.add(hotCore);
    const light = new T.PointLight(0xff6b21, 0, 115, 1.7);
    light.position.y = originY; group.add(light);

    const shockMaterial = new T.MeshBasicMaterial({ color: 0xffe0a6, transparent: true, opacity: 0, side: T.DoubleSide, blending: T.AdditiveBlending, depthWrite: false });
    const shockRing = new T.Mesh(new T.RingGeometry(.965, 1, giantYield ? 96 : 160), shockMaterial);
    shockRing.rotation.x = -Math.PI / 2; shockRing.position.y = .68; group.add(shockRing);
    const pressureDome = new T.Mesh(new T.SphereGeometry(1, giantYield ? 32 : 48, giantYield ? 18 : 28), new T.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } }, vertexShader: pressureShellVertex, fragmentShader: pressureShellFragment,
      transparent: true, side: T.DoubleSide, blending: T.AdditiveBlending, depthWrite: false
    }));
    pressureDome.position.y = originY; group.add(pressureDome);
    const condensation = new T.Mesh(new T.SphereGeometry(1, giantYield ? 24 : 40, giantYield ? 14 : 22), new T.MeshBasicMaterial({ color: 0xf1eadb, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending }));
    condensation.position.y = originY; group.add(condensation);
    const groundFlash = new T.Mesh(new T.CircleGeometry(1, 80), new T.MeshBasicMaterial({ map: textures.glow, color: 0xff8a25, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
    groundFlash.rotation.x = -Math.PI / 2; groundFlash.position.y = .72; group.add(groundFlash);

    const yieldRoot = Math.cbrt(yieldKt / 100);
    const smokeCount = giantYield ? 180 : yieldKt >= 10000 ? 240 : Math.round(clamp(210 + Math.max(0, Math.log10(yieldKt / 100)) * 16, 210, 270));
    const capCount = Math.round(smokeCount * .74);
    const dustCount = giantYield ? 105 : Math.round(clamp(110 + Math.max(0, Math.log10(yieldKt / 100)) * 12, 110, 160));
    const emberCount = giantYield ? 42 : 72;
    const smoke = createSmokeVolume(smokeCount, giantYield);
    const dust = createParticleCloud(dustCount, textures.smoke);
    const embers = createParticleCloud(emberCount, textures.spark, T.AdditiveBlending);
    group.add(smoke, dust, embers);

    const random = randomGenerator(state.seed + state.totalBlasts * 307 + Math.round(yieldKt));
    const smokeData = Array.from({ length: smokeCount }, (_, index) => ({
      cap: index < capCount, angle: random() * Math.PI * 2, radial: Math.pow(random(), .58),
      birth: index < capCount ? .7 + random() * 5.3 : .25 + random() * 5.8,
      size: (index < capCount ? 13 + random() * 25 : 9 + random() * 18) * strength * (giantYield ? 1.38 : 1),
      wobble: random() * Math.PI * 2, drift: (random() - .5) * 5, shade: random(), layer: random(),
      stretchX: .72 + random() * .72, stretchY: .7 + random() * .9
    }));
    smokeData.forEach((particle) => { particle.cosAngle = Math.cos(particle.angle); particle.sinAngle = Math.sin(particle.angle); });
    const dustData = Array.from({ length: dustCount }, () => ({ angle: random() * Math.PI * 2, birth: .25 + random() * 2.1, speed: 10 + random() * 32, lift: 1 + random() * 10, size: (2.5 + random() * 7) * strength, shade: random() }));
    const emberData = Array.from({ length: emberCount }, () => ({ angle: random() * Math.PI * 2, elev: (random() - .35) * Math.PI, birth: random() * 2.8, speed: 8 + random() * 30, size: 1 + random() * 2.3 }));

    const scorch = new T.Mesh(new T.CircleGeometry(1, 64), new T.MeshBasicMaterial({ color: 0x120b08, transparent: true, opacity: .82, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    scorch.rotation.x = -Math.PI / 2; scorch.position.set(position.x, .7, position.z); scorch.scale.setScalar(.1);
    effectsGroup.add(scorch);
    state.scars.push(scorch);
    while (state.scars.length > 36) {
      const old = state.scars.shift(); effectsGroup.remove(old); old.geometry.dispose(); old.material.dispose();
    }

    const shockMax = 4200 + Math.cbrt(yieldKt) * 330;
    // Severe structural damage grows with yield. For giant shots, sample the
    // entire broad zone uniformly so destruction spreads across the map without
    // turning tens of thousands of instances into rigid bodies at once.
    const damageRadius = Math.min(shockMax, clamp(1900 * Math.pow(yieldKt / 100, .15), 1900, 6500));
    const physicalLimit = yieldKt >= 1000000 ? 180 : yieldKt >= 10000 ? 320 : 600;
    const visualLimit = giantYield ? 2200 : 3000;
    const blast = {
      id: ++state.totalBlasts, startTime: state.worldTime, yieldKt, heightMeters, strength, originY,
      timeScale: clamp(1 + Math.max(0, Math.log10(yieldKt / 100)) * .12, 1, 1.65),
      position: position.clone(), group, fireball, innerHeat, solidCore, glow, hotCore, light, shockRing, pressureDome, condensation, groundFlash, smoke, dust, embers,
      smokeData, dustData, emberData, scorch, automatic, phaseIndex: -1, yieldRoot, shockMax,
      shockDuration: clamp(5.4 + Math.max(0, Math.log10(yieldKt / 100)) * .78, 5.4, 10.2), cameraImpactTime: null,
      physicalImpacts: new Float32Array(0), visualImpacts: new Float32Array(0), physicalCursor: 0, visualCursor: 0,
      integrityBuildings: [], candidateCount: 0, candidatesPending: true,
      giantYield, effectModulo: giantYield ? 2 : 1
    };
    state.blasts.push(blast);
    requestBlastCandidates(blast, damageRadius * 1.05, physicalLimit, visualLimit);
    state.latestBlast = blast;
    state.phaseIndex = -1;
    ui.predictedRadius.textContent = `${state.totalBlasts} 枚`;
    ui.predictionState.textContent = state.sequenceActive ? "连续投放中" : "已引爆";
    ui.blastCounter.textContent = `爆点 ${String(state.totalBlasts).padStart(2, "0")}`;
    ui.pauseBtn.disabled = false;
    ui.systemStatus.textContent = withPhysicsMode(state.sequenceActive ? "CONTINUOUS DEPLOYMENT ACTIVE" : "3D SANDBOX LIVE");
    addLog(`爆点 ${String(blast.id).padStart(2, "0")} 已投放`, "alert");
    showEvent("NEW BLAST", automatic ? "连续序列自动投放" : "自由爆点已引爆", blast);
    playExplosionAudio(blast);
    return blast;
  }

  function updateBlast(blast, age) {
    age /= blast.timeScale;
    const strength = blast.strength;
    const fireRadius = 260 * Math.pow(blast.yieldRoot, .72);
    const growth = easeOutExpo(age / 1.15);
    const fireFade = 1 - smoothstep(1.3, 7.2, age);
    blast.fireball.visible = age < 7.4;
    blast.fireball.scale.setScalar(Math.max(.01, fireRadius * growth * (1 + Math.max(0, age - 1.4) * .018)));
    blast.fireball.material.uniforms.uTime.value = age;
    blast.fireball.material.uniforms.uOpacity.value = fireFade;
    blast.fireball.rotation.y = age * .08; blast.fireball.rotation.x = age * .035;
    blast.innerHeat.visible = fireFade > .004;
    blast.innerHeat.scale.setScalar(Math.max(.01, fireRadius * growth * .82));
    blast.innerHeat.rotation.set(-age * .025, age * .06, age * .018);
    blast.innerHeat.material.opacity = fireFade * .82;
    const coreFade = 1 - smoothstep(3.1, 6.6, age);
    const coreCooling = smoothstep(.65, 5.7, age);
    blast.solidCore.visible = coreFade > .004;
    blast.solidCore.scale.setScalar(Math.max(.01, fireRadius * growth * (.46 + smoothstep(.2, 2.4, age) * .08)));
    blast.solidCore.material.opacity = coreFade;
    blast.solidCore.material.color.setRGB(1, lerp(.98, .31, coreCooling), lerp(.78, .035, coreCooling));
    blast.glow.visible = age < 7;
    blast.glow.scale.setScalar(fireRadius * growth * (4.8 + age * .08));
    blast.glow.material.opacity = fireFade * .96;
    blast.hotCore.visible = age < 4.8;
    blast.hotCore.scale.setScalar(fireRadius * growth * 2.15);
    blast.hotCore.material.opacity = (1 - smoothstep(.08, 4.8, age));
    blast.light.intensity = Math.max(0, 220 * strength * (1 - smoothstep(.18, 5.2, age)));
    blast.light.distance = 420 + fireRadius * 8;
    blast.groundFlash.scale.setScalar(fireRadius * (1.1 + easeOutCubic(age / 2.8) * 3.3));
    const groundCoupling = clamp(1 - blast.heightMeters / 4200, .18, 1);
    blast.groundFlash.material.opacity = (1 - smoothstep(.12, 4.8, age)) * .62 * groundCoupling;
    blast.groundFlash.visible = age < 4.9;

    const shockMax = blast.shockMax;
    const shockProgress = easeOutCubic((age - .13) / blast.shockDuration);
    const shockRadius = shockMax * shockProgress;
    const shockAlpha = smoothstep(.1, .38, age) * (1 - smoothstep(blast.shockDuration * .82, blast.shockDuration + 2.8, age));
    const shellVisible = age > .1 && age < blast.shockDuration + 2.8;
    // The front is a sphere centred on the actual burst. A ground ring appears
    // only once that sphere intersects the terrain.
    blast.pressureDome.visible = shellVisible;
    blast.pressureDome.scale.setScalar(Math.max(.01, shockRadius));
    blast.pressureDome.material.uniforms.uOpacity.value = shockAlpha * .46;
    const intersectsGround = shockRadius > blast.originY;
    const groundIntersection = intersectsGround ? Math.sqrt(Math.max(0, shockRadius * shockRadius - blast.originY * blast.originY)) : 0;
    blast.shockRing.visible = shellVisible && intersectsGround;
    blast.shockRing.scale.setScalar(Math.max(.01, groundIntersection));
    blast.shockRing.material.opacity = shockAlpha * .7;
    const humid = state.environment === "coast" ? 1 : state.environment === "city" ? .68 : .28;
    const condensationAlpha = smoothstep(.12,.5,age) * (1-smoothstep(.7,2.7,age)) * humid;
    blast.condensation.visible = shellVisible && condensationAlpha > .002;
    blast.condensation.scale.setScalar(Math.max(.01, shockRadius * .82));
    blast.condensation.material.opacity = condensationAlpha * .2;
    blast.scorch.scale.setScalar(lerp(.1, fireRadius * 1.65, smoothstep(.2, 3.2, age)));

    const smokeFade = 1 - smoothstep(24, 31, age);
    blast.smoke.visible = smokeFade > .002;
    blast.dust.visible = age < 8.2;
    blast.embers.visible = age < 5.7;
    const capWidth = (700 + blast.yieldRoot * 110) * smoothstep(.45, 11.5, age);
    const rise = (850 + blast.yieldRoot * 160) * smoothstep(.35, 14.5, age);
    const wind = environments[state.environment].wind * .025;
    blastCenter.set(blast.position.x, blast.originY, blast.position.z);
    const cameraDistance = cameraWorldPosition.distanceTo(blastCenter);
    const distanceModulo = cameraDistance > 14000 ? 6 : cameraDistance > 7000 ? 3 : 1;
    const performanceModulo = state.lastFps < 38 ? 5 : state.lastFps < 48 ? 3 : 1;
    const effectModulo = Math.max(blast.effectModulo, state.blasts.length > 3 ? 4 : state.blasts.length > 1 ? 2 : 1, distanceModulo, performanceModulo);
    const updateVolumetrics = (state.animationFrame + blast.id) % effectModulo === 0;
    if (updateVolumetrics) {
    if (blast.smoke.visible) {
    blast.smokeData.forEach((p, index) => {
      const localAge = age - p.birth;
      if (localAge < 0) { setSmokeBlob(blast.smoke, index, 0, -10000, 0, 0, particleBlack, 1, 1, 0); return; }
      const maturity = smoothstep(0, 5.4, localAge);
      let x, y, z;
      if (p.cap) {
        const radial = capWidth * p.radial * (.35 + maturity * .72);
        x = p.cosAngle * radial + wind * localAge * 2 + p.drift;
        z = p.sinAngle * radial * (.8 + p.layer * .25);
        const dome = (1 - p.radial) * capWidth * .22;
        y = blast.originY + rise * (.28 + maturity * .72) + dome + Math.sin(p.wobble + localAge * .55) * 4.2;
      } else {
        const stemRadius = (62 + blast.yieldRoot * 12) * (1 - maturity * .16);
        x = Math.cos(p.angle * 2.7 + maturity * 2.4) * stemRadius * (.4 + p.radial) + wind * localAge;
        z = Math.sin(p.angle * 2.7 + maturity * 2.4) * stemRadius * (.4 + p.radial);
        const stemBase = blast.heightMeters > 800 ? Math.max(8, blast.originY * .7) : .8;
        y = lerp(stemBase, blast.originY + rise * .78, maturity) + Math.sin(p.wobble + localAge) * 3.4;
      }
      const hot = clamp(1 - localAge / 4.8);
      const mix = hot * .68;
      particleColor.setRGB(
        lerp(.055 + p.shade * .085, .72, mix),
        lerp(.052 + p.shade * .065, .18 + p.shade * .08, mix),
        lerp(.048 + p.shade * .048, .035, mix)
      );
      const volumeFade = smoothstep(0, .42, localAge) * smokeFade;
      const blobSize = p.size * (1.15 + maturity * 2.15) * volumeFade;
      setSmokeBlob(blast.smoke, index, x, y, z, blobSize, particleColor, p.stretchX, p.stretchY, p.wobble + localAge * .045);
    });
    blast.smoke.instanceMatrix.needsUpdate = true;
    blast.smoke.instanceColor.needsUpdate = true;
    }

    if (blast.dust.visible) {
    blast.dustData.forEach((p, index) => {
      const localAge = age - p.birth;
      if (localAge < 0 || localAge > 8) { setParticle(blast.dust, index, 0, 0, 0, particleBlack, 0, 0); return; }
      const radius = p.speed * easeOutCubic(localAge / 6.5) * strength * groundCoupling;
      const x = Math.cos(p.angle) * radius;
      const z = Math.sin(p.angle) * radius;
      const y = .5 + Math.sin(clamp(localAge / 5) * Math.PI) * p.lift;
      particleColor.setRGB(.33 + p.shade * .18, .27 + p.shade * .13, .19 + p.shade * .09);
      const alpha = smoothstep(0,.45,localAge) * (1 - smoothstep(4,8,localAge)) * .42;
      setParticle(blast.dust, index, x, y, z, particleColor, p.size * (1 + localAge * .22), alpha);
    });
    markParticleUpdate(blast.dust);
    }

    if (blast.embers.visible) {
    blast.emberData.forEach((p, index) => {
      const localAge = age - p.birth;
      if (localAge < 0 || localAge > 5.5) { setParticle(blast.embers, index, 0, blast.originY, 0, particleBlack, 0, 0); return; }
      const radius = p.speed * localAge;
      const x = Math.cos(p.angle) * Math.cos(p.elev) * radius;
      const z = Math.sin(p.angle) * Math.cos(p.elev) * radius;
      const y = blast.originY + Math.sin(p.elev) * radius + localAge * 2.5 - localAge * localAge * 1.4;
      setParticle(blast.embers, index, x, y, z, particleEmber, p.size, 1 - localAge / 5.5);
    });
    markParticleUpdate(blast.embers);
    }
    }

    if (age > .12 && age < blast.shockDuration + 1.2 && !blast.candidatesPending) {
      let physicalBudget = blast.giantYield ? 24 : 42;
      while (blast.physicalCursor < blast.physicalImpacts.length && physicalBudget > 0) {
        const distance = blast.physicalImpacts[blast.physicalCursor + 1];
        if (shockRadius < distance) break;
        const building = state.buildings[Math.round(blast.physicalImpacts[blast.physicalCursor])];
        blast.physicalCursor += 2;
        physicalBudget--;
        if (!building) continue;
        const dx = building.position.x - blast.position.x;
        const dz = building.position.z - blast.position.z;
        const dy = building.position.y - blast.originY;
        const force = clamp(1 - distance / shockMax) * clamp(1.15 - blast.heightMeters / 5000);
        const data = building.userData;
        data.damageTarget = clamp(data.damageTarget + force * (.58 + strength * .16));
        applyBlastImpulse(building, blast, force, dx, dy, dz);
        if (force * strength > .66 && !data.fragmented) spawnRubble(building, blast, force, dx, dz);
      }
      let visualBudget = blast.giantYield ? 180 : 260;
      while (blast.visualCursor < blast.visualImpacts.length && visualBudget > 0) {
        const distance = blast.visualImpacts[blast.visualCursor + 1];
        if (shockRadius < distance) break;
        const building = state.buildings[Math.round(blast.visualImpacts[blast.visualCursor])];
        blast.visualCursor += 2;
        visualBudget--;
        if (!building || building.userData.activated) continue;
        const dx = building.position.x - blast.position.x;
        const dz = building.position.z - blast.position.z;
        const force = clamp(1 - distance / blast.shockMax) * clamp(1.15 - blast.heightMeters / 5000);
        if (force > .025) applyVisualDamage(building, blast, force, dx, dz);
      }
    }
  }

  function applyVisualDamage(building, blast, force, dx, dz) {
    const data = building.userData;
    if (data.activated) return;
    const horizontalLength = Math.max(.001, Math.hypot(dx, dz));
    const nx = dx / horizontalLength, nz = dz / horizontalLength;
    const lean = force * clamp(.13 + blast.strength * .055, .14, .62);
    data.visualTiltX = clamp(data.visualTiltX + nz * lean, -.9, .9);
    data.visualTiltZ = clamp(data.visualTiltZ - nx * lean, -.9, .9);
    data.visualSink = clamp(data.visualSink + force * data.height * .07, 0, data.height * .22);
    data.damageTarget = clamp(data.damageTarget + force * (.34 + blast.strength * .08));
    instanceDummy.position.set(data.originalX - data.instanceOriginX, data.baseY - data.visualSink, data.originalZ - data.instanceOriginZ);
    instanceDummy.rotation.set(data.visualTiltX, 0, data.visualTiltZ);
    instanceDummy.scale.set(data.width, data.height, data.depth);
    instanceDummy.updateMatrix();
    building.instanceMesh.setMatrixAt(building.instanceIndex, instanceDummy.matrix);
    building.instanceMesh.instanceMatrix.needsUpdate = true;
  }

  function applyBlastImpulse(building, blast, force, dx, dy, dz) {
    const data = building.userData;
    const rigidBuildingLimit = blast.giantYield ? 360 : 520;
    if (!data.activated && state.activeBuildings.length >= rigidBuildingLimit) {
      applyVisualDamage(building, blast, force, dx, dz);
      canvas.dataset.rigidBodyLimit = String(rigidBuildingLimit);
      return;
    }
    const body = ensureBuildingBody(building);
    if (!data.activated) {
      data.activated = true;
      state.activeBuildings.push(building);
      building.instanceMesh.setMatrixAt(building.instanceIndex, hiddenMatrix);
      building.instanceMesh.instanceMatrix.needsUpdate = true;
      const mesh = new T.Mesh(buildingUnitGeometry, building.material);
      mesh.scale.set(data.width, data.height, data.depth);
      mesh.position.copy(building.position);
      mesh.castShadow = !blast.giantYield && state.activeBuildings.length < 120;
      mesh.receiveShadow = true;
      worldGroup.add(mesh);
      building.mesh = mesh;
      // Mass is expressed in scaled metric tonnes (roughly 0.32 t/m³ for a
      // mostly hollow building), not an arbitrary tiny cap shared by all towers.
      body.mass = clamp(data.width * data.depth * data.height * .32, 800, 80000);
      if (state.physicsWorkerEnabled) {
        queuePhysicsCommand({ type: "activateBuilding", id: body.id, mass: body.mass });
      } else {
        body.type = C.Body.DYNAMIC;
        body.updateMassProperties();
        body.aabbNeedsUpdate = true;
        body.wakeUp();
      }
    }
    const length = Math.max(.001, Math.hypot(dx, dy, dz));
    const nx = dx / length, ny = dy / length, nz = dz / length;
    const horizontalLength = Math.max(.001, Math.hypot(dx, dz));
    const horizontalX = dx / horizontalLength, horizontalZ = dz / horizontalLength;
    const mass = body.mass;
    // Blast loading follows exposed facade/roof area. Because it is no longer
    // proportional to mass, heavier and deeper structures accelerate less.
    const wallArea = data.height * (Math.abs(nx) * data.depth + Math.abs(nz) * data.width);
    const roofArea = Math.abs(ny) * data.width * data.depth;
    const exposedArea = Math.max(18, wallArea + roofArea);
    const impulsePower = exposedArea * force * (18 + blast.strength * 12);
    const verticalShare = ny < 0 ? Math.max(-.48, ny) : 0;
    const horizontalShare = 1 - Math.min(.28, Math.abs(verticalShare) * .34);
    const impulse = [horizontalX * impulsePower * horizontalShare, verticalShare * impulsePower, horizontalZ * impulsePower * horizontalShare];
    const hitPoint = [-nz * data.width * .22, data.height * (.22 + force * .2), nx * data.depth * .22];
    const rotationalKick = force * clamp(5200 / mass, .08, .7) * (.18 + blast.strength * .045);
    if (state.physicsWorkerEnabled) {
      queuePhysicsCommand({
        type: "impulse", id: body.id,
        impulse, point: hitPoint, angular: [-nz * rotationalKick, 0, nx * rotationalKick]
      });
    } else {
      body.applyImpulse(new C.Vec3(...impulse), new C.Vec3(...hitPoint));
      body.angularVelocity.x += -nz * rotationalKick;
      body.angularVelocity.z += nx * rotationalKick;
      body.wakeUp();
    }
  }

  function spawnRubble(building, blast, force, dx, dz) {
    const data = building.userData;
    data.fragmented = true;
    const random = randomGenerator(blast.id * 991 + Math.floor(data.originalX * 17 + data.originalZ * 29));
    const count = Math.min(blast.giantYield ? 4 : 7, 3 + Math.floor(force * 5));
    const rubbleLimit = blast.giantYield ? 64 : blast.yieldKt >= 10000 ? 110 : 180;
    const length = Math.max(.001, Math.hypot(dx, dz));
    const nx = dx / length, nz = dz / length;
    for (let i = 0; i < count && state.rubble.length < rubbleLimit; i++) {
      const sx = .8 + random() * Math.min(4, data.width * .35);
      const sy = .6 + random() * Math.min(3.5, data.height * .12);
      const sz = .8 + random() * Math.min(4, data.depth * .35);
      const materialIndex = Math.floor(random() * rubbleMaterials.length);
      const allocation = allocateRubbleSlot(materialIndex);
      if (!allocation) break;
      const position = new T.Vector3(
        building.position.x + (random() - .5) * data.width * .7,
        building.position.y + data.height * (.28 + random() * .45),
        building.position.z + (random() - .5) * data.depth * .7
      );
      const item = {
        batch: allocation.batch, slot: allocation.slot, position, quaternion: new T.Quaternion(),
        size: new T.Vector3(sx, sy, sz), body: null, born: state.worldTime
      };
      updateRubbleInstance(item);
      item.batch.mesh.instanceMatrix.needsUpdate = true;
      const mass = clamp(sx * sy * sz * 1.6, 2, 45);
      if (state.physicsWorkerEnabled) {
        const body = createWorkerBody(position, mass);
        item.body = body;
        state.rubble.push(item);
        state.physicsObjects.set(body.id, { kind: "rubble", body, item });
        queuePhysicsCommand({
          type: "addRubble", id: body.id,
          size: [sx, sy, sz], mass,
          position: [position.x, position.y, position.z],
          velocity: [nx * force * (10 + random() * 16), 1.5 + random() * 6, nz * force * (10 + random() * 16)],
          angular: [(random() - .5) * 8, (random() - .5) * 8, (random() - .5) * 8]
        });
        continue;
      }
      const body = new C.Body({ mass, material: state.physicsMaterial, shape: new C.Box(new C.Vec3(sx / 2, sy / 2, sz / 2)) });
      body.collisionFilterGroup = 4;
      body.collisionFilterMask = 1;
      body.position.set(position.x, position.y, position.z);
      body.linearDamping = .18; body.angularDamping = .24;
      body.velocity.set(nx * force * (10 + random() * 16), 1.5 + random() * 6, nz * force * (10 + random() * 16));
      body.angularVelocity.set((random() - .5) * 8, (random() - .5) * 8, (random() - .5) * 8);
      state.physicsWorld.addBody(body);
      item.body = body;
      state.rubble.push(item);
    }
  }

  function removeBlast(blast) {
    effectsGroup.remove(blast.group);
    blast.group.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }

  function updateBuildings(delta) {
    canvas.dataset.activeBuildings = String(state.activeBuildings.length);
    canvas.dataset.rubbleInstances = String(state.rubble.length);
    canvas.dataset.physicsQueued = String(state.physicsCommandQueue.length);
    if (!state.paused && state.physicsWorkerEnabled && state.physicsWorkerReady) {
      state.physicsAccumulator += Math.min(.05, delta * state.speed);
      flushPhysicsCommands();
      const hasDynamics = state.activeBuildings.length || state.rubble.length;
      if (hasDynamics && !state.physicsStepPending && state.physicsAccumulator >= 1 / 45) {
        state.physicsStepPending = true;
        const physicsDelta = Math.min(.05, state.physicsAccumulator);
        state.physicsAccumulator = 0;
        state.physicsWorker.postMessage({ type: "step", generation: state.physicsGeneration, delta: physicsDelta });
      }
    } else if (!state.paused && state.physicsWorld) {
      state.physicsWorld.step(1 / 60, Math.min(.05, delta * state.speed), 4);
    }
    state.activeBuildings.forEach((building) => {
      const data = building.userData;
      data.damage += (data.damageTarget - data.damage) * Math.min(1, delta * 2.1);
      if (data.activated && !state.physicsWorkerEnabled) {
        // Whole structures may topple and slide, but solver contacts must never
        // turn them into projectiles. Negative velocity remains unrestricted so
        // the visible fall still follows 9.81 m/s².
        data.body.velocity.y = Math.min(data.body.velocity.y, .35);
        const horizontalSpeed = Math.hypot(data.body.velocity.x, data.body.velocity.z);
        if (horizontalSpeed > 22) {
          const scale = 22 / horizontalSpeed;
          data.body.velocity.x *= scale; data.body.velocity.z *= scale;
        }
        building.position.set(data.body.position.x, data.body.position.y, data.body.position.z);
        building.mesh.position.copy(building.position);
        building.mesh.quaternion.set(data.body.quaternion.x, data.body.quaternion.y, data.body.quaternion.z, data.body.quaternion.w);
      }
    });
    for (let i = state.rubble.length - 1; i >= 0; i--) {
      const item = state.rubble[i];
      if (!state.physicsWorkerEnabled) {
        item.position.set(item.body.position.x, item.body.position.y, item.body.position.z);
        item.quaternion.set(item.body.quaternion.x, item.body.quaternion.y, item.body.quaternion.z, item.body.quaternion.w);
        updateRubbleInstance(item);
        item.batch.mesh.instanceMatrix.needsUpdate = true;
      }
      if (state.worldTime - item.born > 18 || item.body.position.y < -30) {
        if (state.physicsWorkerEnabled) {
          state.physicsObjects.delete(item.body.id);
          queuePhysicsCommand({ type: "removeBody", id: item.body.id });
        } else state.physicsWorld.removeBody(item.body);
        releaseRubbleInstance(item);
        state.rubble.splice(i, 1);
      }
    }
  }

  function updateBlasts(delta) {
    if (!state.paused) state.worldTime += delta * state.speed;
    if (state.sequenceActive && !state.paused && state.worldTime >= state.nextBlastAt) {
      const index = state.totalBlasts;
      const angle = index * 2.399;
      const radius = 18 + Math.min(250, index * 12);
      const point = state.targetPoint.clone();
      point.x = clamp(point.x + Math.cos(angle) * radius * 2.2, -9500, 9500);
      point.z = clamp(point.z + Math.sin(angle) * radius * 2.2, -9500, 9500);
      createBlast(point, true);
      state.nextBlastAt = state.worldTime + state.interval;
    }
    let flash = 0;
    let skyGlow = 0;
    let lightBudget = 2;
    for (let index = state.blasts.length - 1; index >= 0; index--) {
      const blast = state.blasts[index];
      const age = state.worldTime - blast.startTime;
      const visualAge = age / blast.timeScale;
      updateBlast(blast, age);
      const lightActive = visualAge < 5.3 && lightBudget > 0;
      blast.light.visible = lightActive;
      if (lightActive) lightBudget--;
      flash = Math.max(flash, clamp(1 - visualAge / .42) * .99);
      skyGlow = Math.max(skyGlow, (1 - smoothstep(.08, 4.8, visualAge)));
      if (age > 31 * blast.timeScale) { removeBlast(blast); state.blasts.splice(index, 1); }
    }
    renderer.shadowMap.enabled = !state.blasts.some((blast) => blast.giantYield);
    ui.whiteFlash.style.opacity = String(flash);
    renderer.toneMappingExposure = .92 + skyGlow * .82 + flash * 1.45;
    const sky = worldGroup.getObjectByName("sky");
    if (sky) sky.material.uniforms.blastGlow.value = skyGlow;
    updateBuildings(delta);
  }

  function updateCamera(delta) {
    const cam = state.camera;
    cameraForward.set(Math.sin(cam.theta), 0, Math.cos(cam.theta)).normalize();
    cameraRight.set(cameraForward.z, 0, -cameraForward.x);
    cameraMove.set(0,0,0);
    if (state.keys.has("KeyW")) cameraMove.addScaledVector(cameraForward, -1);
    if (state.keys.has("KeyS")) cameraMove.add(cameraForward);
    if (state.keys.has("KeyA")) cameraMove.addScaledVector(cameraRight, -1);
    if (state.keys.has("KeyD")) cameraMove.add(cameraRight);
    const speed = (state.keys.has("ShiftLeft") || state.keys.has("ShiftRight")) ? 1450 : 360;
    if (cameraMove.lengthSq()) cam.target.addScaledVector(cameraMove.normalize(), speed * delta);
    if (state.keys.has("KeyQ")) cam.target.y -= speed * .55 * delta;
    if (state.keys.has("KeyE")) cam.target.y += speed * .55 * delta;
    cam.target.x = clamp(cam.target.x, -9800, 9800); cam.target.z = clamp(cam.target.z, -9800, 9800); cam.target.y = clamp(cam.target.y, 2, 3200);
    const longView = smoothstep(900, 11000, cam.radius);
    const highView = smoothstep(250, 3000, cam.target.y);
    scene.fog.density = lerp(.000085, .000018, Math.max(longView, highView * .72));
    const sinPhi = Math.sin(cam.phi);
    cameraWorldPosition.set(
      cam.target.x + cam.radius * sinPhi * Math.sin(cam.theta),
      cam.target.y + cam.radius * Math.cos(cam.phi),
      cam.target.z + cam.radius * sinPhi * Math.cos(cam.theta)
    );
    // Permit genuine upward-looking angles while keeping the observer above
    // terrain. Previously phi stopped before the horizon, so high airbursts
    // could never be framed with the mouse.
    cameraWorldPosition.y = Math.max(2.4, cameraWorldPosition.y);
    let shake = 0;
    let fovKick = 0;
    let fireballImmersion = 0;
    for (const blast of state.blasts) {
      const visualAge = (state.worldTime - blast.startTime) / blast.timeScale;
      const shockRadius = blast.shockMax * easeOutCubic((visualAge - .13) / blast.shockDuration);
      blastCenter.set(blast.position.x, blast.originY, blast.position.z);
      const distance = cameraWorldPosition.distanceTo(blastCenter);
      const currentFireRadius = 260 * Math.pow(blast.yieldRoot, .72) * easeOutExpo(visualAge / 1.15) * (1 + Math.max(0, visualAge - 1.4) * .018);
      if (visualAge < 7.2 && currentFireRadius > 1 && distance < currentFireRadius * .98) {
        // An enclosing transparent mesh becomes a visibly faceted shell from
        // the inside. Replace those surfaces with continuous emissive density;
        // the opaque 3D core returns automatically as the observer exits.
        blast.fireball.visible = false;
        if (distance < currentFireRadius * .84) blast.innerHeat.visible = false;
        if (distance < currentFireRadius * .56) blast.solidCore.visible = false;
        const heatFade = 1 - smoothstep(1.3, 7.2, visualAge);
        fireballImmersion = Math.max(fireballImmersion, heatFade * clamp(.42 + (1 - distance / currentFireRadius) * .5, .42, .92));
      }
      if (blast.cameraImpactTime === null && visualAge > .12 && shockRadius >= distance) blast.cameraImpactTime = state.worldTime;
      if (blast.cameraImpactTime !== null) {
        const impactAge = (state.worldTime - blast.cameraImpactTime) / blast.timeScale;
        if (impactAge < 2.8) {
          const envelope = (1 - smoothstep(0, 2.8, impactAge)) * (1 - Math.exp(-impactAge * 28));
          const impact = clamp(1.4 + blast.strength * 1.55, 1.5, 18) * envelope;
          shake = Math.max(shake, impact);
          fovKick = Math.max(fovKick, impact * .32);
        }
      }
    }
    if (fireballImmersion > .001) {
      ui.whiteFlash.style.background = "#ffb12b";
      ui.whiteFlash.style.opacity = String(Math.max(Number(ui.whiteFlash.style.opacity) || 0, fireballImmersion));
    } else ui.whiteFlash.style.background = "#fffde5";
    if (shake > 0) {
      cameraWorldPosition.x += Math.sin(state.worldTime * 64) * shake;
      cameraWorldPosition.y += Math.sin(state.worldTime * 51) * shake * .5;
    }
    camera.position.copy(cameraWorldPosition);
    camera.lookAt(cam.target);
    updateAudioListener();
    const cullMoved = !Number.isFinite(state.chunkCullX) || Math.hypot(cameraWorldPosition.x - state.chunkCullX, cameraWorldPosition.z - state.chunkCullZ) > 120 || state.animationFrame % 45 === 0;
    if (cullMoved) {
      const cityViewDistance = clamp(2600 + cam.radius * 1.25 + cameraWorldPosition.y * .72, 4200, 24000);
      let visibleCityChunks = 0;
      for (const chunk of state.cityChunks) {
        const visible = Math.hypot(chunk.x - cameraWorldPosition.x, chunk.z - cameraWorldPosition.z) <= cityViewDistance + chunk.radius;
        if (visible) visibleCityChunks++;
        for (const mesh of chunk.meshes) mesh.visible = visible;
      }
      state.chunkCullX = cameraWorldPosition.x;
      state.chunkCullZ = cameraWorldPosition.z;
      state.visibleCityChunks = visibleCityChunks;
    }
    canvas.dataset.cityChunks = `${state.visibleCityChunks}/${state.cityChunks.length}`;
    const nextFov = 48 + fovKick;
    if (Math.abs(camera.fov - nextFov) > .02) { camera.fov = nextFov; camera.updateProjectionMatrix(); }
    const sky = worldGroup.getObjectByName("sky");
    if (sky) sky.position.copy(cameraWorldPosition);
    sun.position.set(cam.target.x - 420, cam.target.y + 780, cam.target.z + 360);
    sun.target.position.copy(cam.target);
    if (targetMarker) {
      const pulse = 1 + Math.sin(performance.now() * .004) * .12;
      targetMarker.userData.ring.scale.setScalar(pulse);
    }
  }

  function updateTelemetry() {
    const blast = state.latestBlast;
    const age = blast ? Math.max(0, state.worldTime - blast.startTime) / blast.timeScale : 0;
    if (blast) {
      let phaseIndex = -1;
      phases.forEach((phase, index) => { if (age >= phase.at) phaseIndex = index; });
      if (phaseIndex !== state.phaseIndex && phaseIndex >= 0) {
        state.phaseIndex = phaseIndex;
        const phase = phases[phaseIndex];
        ui.phaseNumber.textContent = phase.number; ui.phaseName.textContent = phase.name; ui.phaseSub.textContent = phase.sub; ui.phaseLabel.textContent = phase.name;
        showEvent(`PHASE ${phase.number}`, phase.title, blast);
      }
      const fireMax = 520 * Math.pow(blast.yieldRoot, .72);
      const fire = fireMax * easeOutExpo(age / 1.15) * (1 - smoothstep(4,8,age));
      const shock = blast.shockMax * .001 * easeOutCubic((age - .13) / blast.shockDuration);
      const cloudRise = (850 + blast.yieldRoot * 160) * smoothstep(.35,14.5,age);
      const cloud = (blast.originY + cloudRise) * .001;
      const seismicCoupling = lerp(.62, 1, clamp(1 - blast.heightMeters / 4200, .18, 1));
      const seismic = (1.7 + Math.log10(blast.yieldKt) * .85) * seismicCoupling * (1 - smoothstep(6,18,age) * .34);
      ui.fireballMetric.textContent = Math.round(Math.max(0, fire)).toLocaleString("zh-CN");
      ui.shockMetric.textContent = Math.max(0,shock).toFixed(1); ui.cloudMetric.textContent = Math.max(0,cloud).toFixed(1); ui.seismicMetric.textContent = Math.max(0,seismic).toFixed(1);
      ui.fireballBar.style.width = `${clamp(fire/8000)*100}%`; ui.shockBar.style.width = `${clamp(shock/80)*100}%`; ui.cloudBar.style.width = `${clamp(cloud/32)*100}%`; ui.seismicBar.style.width = `${clamp(seismic/9)*100}%`;
      ui.timelineTime.textContent = formatTimeline(age); ui.timelineProgress.style.width = `${clamp(age/18)*100}%`; ui.timecode.textContent = `00:00:${String(Math.floor(age)).padStart(2,"0")}`;
      ui.signalState.textContent = age < 5 ? "PEAK INPUT" : age < 18 ? "DECAYING" : "ARCHIVED";
    } else {
      ui.phaseNumber.textContent = "00"; ui.phaseName.textContent = "自由沙盘"; ui.phaseSub.textContent = "CLICK GROUND TO DEPLOY"; ui.phaseLabel.textContent = "等待投放";
      [ui.fireballMetric, ui.shockMetric, ui.cloudMetric, ui.seismicMetric].forEach((element, index) => element.textContent = index ? "0.0" : "0");
      [ui.fireballBar, ui.shockBar, ui.cloudBar, ui.seismicBar].forEach((bar) => bar.style.width = "0%");
      ui.timelineTime.textContent = "T+00:00.00"; ui.timelineProgress.style.width = "0%"; ui.signalState.textContent = "STANDBY";
    }
    const integritySample = state.latestBlast?.integrityBuildings?.length ? state.latestBlast.integrityBuildings : state.activeBuildings;
    const totalDamage = integritySample.length ? integritySample.reduce((sum,b) => sum+b.userData.damage,0)/integritySample.length : 0;
    const integrity = Math.round((1-totalDamage*.92)*100);
    ui.integrityValue.textContent = `${integrity}%`; ui.integrityBar.style.width = `${integrity}%`;
    ui.integrityValue.style.color = integrity > 72 ? "var(--green)" : integrity > 42 ? "var(--orange)" : "var(--red)";
    ui.integrityNote.textContent = integrity > 85 ? "三维城市结构稳定" : integrity > 50 ? "多栋建筑遭受冲击" : "城市结构大面积倾覆";
  }

  function drawWave() {
    const rect = waveCanvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (waveCanvas.width !== Math.floor(rect.width*dpr) || waveCanvas.height !== Math.floor(rect.height*dpr)) {
      waveCanvas.width = Math.max(1,Math.floor(rect.width*dpr)); waveCanvas.height = Math.max(1,Math.floor(rect.height*dpr)); waveCtx.setTransform(dpr,0,0,dpr,0,0);
    }
    const w=rect.width,h=rect.height; waveCtx.clearRect(0,0,w,h);
    waveCtx.strokeStyle="rgba(148,178,168,.08)"; waveCtx.lineWidth=1;
    for(let y=14;y<h;y+=18){waveCtx.beginPath();waveCtx.moveTo(0,y+.5);waveCtx.lineTo(w,y+.5);waveCtx.stroke();}
    const age=state.latestBlast?Math.max(0,state.worldTime-state.latestBlast.startTime):0;
    const energy=state.latestBlast?(1-smoothstep(0,18,age)):.03;
    ["rgba(143,191,180,.8)","rgba(255,176,52,.76)","rgba(255,86,55,.68)"].forEach((color,index)=>{
      waveCtx.strokeStyle=color;waveCtx.beginPath();
      for(let x=0;x<=w;x+=2){const wave=Math.sin(x*(.18+index*.05)+state.worldTime*(6+index*2))*(1.2+energy*5);const spike=Math.exp(-Math.pow((x/w-clamp(age/18))*24,2))*12*energy;const y=18+index*25+wave+spike*Math.sin(x*.75);if(x)waveCtx.lineTo(x,y);else waveCtx.moveTo(x,y);}waveCtx.stroke();
    });
  }

  function showEvent(kicker, title, blast) {
    ui.eventKicker.textContent = kicker; ui.eventTitle.textContent = title; ui.eventTime.textContent = blast ? `#${String(blast.id).padStart(2,"0")}` : "LIVE";
    ui.eventBanner.classList.remove("visible"); requestAnimationFrame(()=>ui.eventBanner.classList.add("visible"));
    clearTimeout(showEvent.timeout); showEvent.timeout=setTimeout(()=>ui.eventBanner.classList.remove("visible"),1350);
  }

  function addLog(message, type="") {
    const now=new Date(); const time=[now.getHours(),now.getMinutes(),now.getSeconds()].map(v=>String(v).padStart(2,"0")).join(":");
    const row=document.createElement("div"); row.innerHTML=`<time>${time}</time><i class="${type}"></i><span>${message}</span>`; ui.logList.prepend(row);
    while(ui.logList.children.length>6)ui.logList.lastElementChild.remove();
  }

  function updateRangeFill(input,color){const percent=((+input.value-+input.min)/(+input.max-+input.min))*100;input.style.background=`linear-gradient(90deg,${color} 0 ${percent}%,rgba(126,149,143,.2) ${percent}%)`;}
  function yieldFromSlider(value){return Math.round(10*Math.pow(1000000,value/100));}
  function sliderFromYield(value){return Math.log10(value/10)/6*100;}
  function updateControls(){
    state.yieldKt=yieldFromSlider(+ui.yieldRange.value);state.burstHeight=+ui.heightRange.value;state.interval=+ui.intervalRange.value;
    ui.yieldOutput.innerHTML=state.yieldKt>=1000000?`${(state.yieldKt/1000000).toFixed(1)} <small>Gt</small>`:state.yieldKt>=1000?`${(state.yieldKt/1000).toFixed(1)} <small>Mt</small>`:`${state.yieldKt} <small>kt</small>`;
    ui.heightOutput.innerHTML=`${state.burstHeight.toLocaleString("zh-CN")} <small>m</small>`;ui.intervalOutput.innerHTML=`${state.interval.toFixed(1)} <small>s</small>`;
    updateRangeFill(ui.yieldRange,"var(--red)");updateRangeFill(ui.heightRange,"var(--cyan)");updateRangeFill(ui.intervalRange,"var(--cyan)");
    ui.burstDescription.textContent=state.burstHeight<150?"地表引爆 · 尘柱更重，地面震动更强":state.burstHeight<1700?"空中引爆 · 冲击波覆盖更广，火球悬空":"高空引爆 · 云柱更高，地面效应减弱";
    $$("[data-yield]").forEach(button=>button.classList.toggle("active",Math.abs(+button.dataset.yield-state.yieldKt)/+button.dataset.yield<.08));
  }

  function triggerDeployment(){
    if(state.continuous){
      state.sequenceActive=!state.sequenceActive;
      if(state.sequenceActive){createBlast(state.targetPoint.clone());state.nextBlastAt=state.worldTime+state.interval;ui.detonateText.textContent="停止连续爆破";ui.detonateHint.textContent="SEQUENCE RUNNING";ui.sequenceState.textContent="RUNNING";ui.predictionState.textContent="连续投放中";ui.systemStatus.textContent=withPhysicsMode("CONTINUOUS DEPLOYMENT ACTIVE");}
      else{ui.detonateText.textContent="启动连续爆破";ui.detonateHint.textContent="AUTO DEPLOYMENT";ui.sequenceState.textContent="ARMED";ui.predictionState.textContent="序列已停止";ui.systemStatus.textContent=withPhysicsMode("3D SANDBOX LIVE");addLog("连续爆破已停止","ok");}
    }else createBlast(state.targetPoint.clone());
  }

  function clearSandbox(){
    stopAllAudioVoices();
    state.sequenceActive=false;state.blasts.forEach(removeBlast);state.blasts=[];state.scars.forEach(s=>{effectsGroup.remove(s);s.geometry.dispose();s.material.dispose();});state.scars=[];
    state.totalBlasts=0;state.latestBlast=null;state.phaseIndex=-1;state.worldTime=0;state.paused=false;
    scene.remove(effectsGroup);effectsGroup=new T.Group();scene.add(effectsGroup);
    state.seed=Math.floor(Math.random()*9000)+1000;buildEnvironment();
    ui.predictedRadius.textContent="0 枚";ui.predictionState.textContent="沙盘就绪";ui.blastCounter.textContent="爆点 00";ui.pauseBtn.disabled=true;ui.pauseBtn.querySelector("span").textContent="Ⅱ";
    ui.detonateText.textContent=state.continuous?"启动连续爆破":"立即投放核爆";ui.detonateHint.textContent=state.continuous?"AUTO DEPLOYMENT":"INSTANT DEPLOYMENT";ui.systemStatus.textContent=withPhysicsMode("3D SANDBOX READY");addLog("三维沙盘已重置","ok");
  }

  function pickGround(event){
    const rect=canvas.getBoundingClientRect();pointer.x=((event.clientX-rect.left)/rect.width)*2-1;pointer.y=-((event.clientY-rect.top)/rect.height)*2+1;raycaster.setFromCamera(pointer,camera);
    const hits=raycaster.intersectObject(groundPlane,false);if(!hits.length)return;
    state.targetPoint.set(clamp(hits[0].point.x,-9800,9800),0,clamp(hits[0].point.z,-9800,9800));targetMarker.position.copy(state.targetPoint);
    ui.targetRadius.textContent=`X ${Math.round(state.targetPoint.x)} · Z ${Math.round(state.targetPoint.z)}`;showEvent("TARGET UPDATED","已选择新的三维爆点",null);
  }

  function resize(){const rect=stage.getBoundingClientRect();state.dimensions={width:rect.width,height:rect.height,dpr:state.renderScale};renderer.setPixelRatio(state.renderScale);renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/Math.max(1,rect.height);camera.updateProjectionMatrix();grainCanvas.width=Math.max(1,Math.floor(rect.width/7));grainCanvas.height=Math.max(1,Math.floor(rect.height/7));}
  function renderGrain(){const w=grainCanvas.width,h=grainCanvas.height;if(!w||!h)return;const image=grainCtx.createImageData(w,h);for(let i=0;i<image.data.length;i+=4){const value=Math.random()*255;image.data[i]=image.data[i+1]=image.data[i+2]=value;image.data[i+3]=Math.random()*48;}grainCtx.putImageData(image,0,0);}

  function createAudioNoiseBuffer(ac, duration, color = "white") {
    const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * duration), ac.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let index = 0; index < data.length; index++) {
      const white = Math.random() * 2 - 1;
      if (color === "brown") {
        brown = (brown + white * .022) / 1.018;
        data[index] = clamp(brown * 3.2, -1, 1);
      } else data[index] = white;
    }
    return buffer;
  }

  function createReverbImpulse(ac, duration = 2.2) {
    const length = Math.ceil(ac.sampleRate * duration);
    const impulse = ac.createBuffer(2, length, ac.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let index = 0; index < length; index++) {
        const time = index / ac.sampleRate;
        data[index] = (Math.random() * 2 - 1) * Math.exp(-time * (2.7 + channel * .24)) * (1 - time / duration);
      }
    }
    return impulse;
  }

  function initAudio() {
    if (state.audioContext) return state.audioContext;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ac = new AC({ latencyHint: "interactive" });
    const master = ac.createGain();
    const compressor = ac.createDynamicsCompressor();
    compressor.threshold.value = -15;
    compressor.knee.value = 18;
    compressor.ratio.value = 7;
    compressor.attack.value = .003;
    compressor.release.value = .42;
    master.gain.value = state.audioEnabled ? .9 : 0;
    master.connect(compressor);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = .72;
    compressor.connect(analyser);
    analyser.connect(ac.destination);

    const reverb = ac.createConvolver();
    const reverbGain = ac.createGain();
    reverb.buffer = createReverbImpulse(ac);
    reverbGain.gain.value = .2;
    reverb.connect(reverbGain);
    reverbGain.connect(master);

    state.audioContext = ac;
    state.masterGain = master;
    state.audioCompressor = compressor;
    state.audioReverb = reverb;
    state.audioAnalyser = analyser;
    state.audioMeterData = new Uint8Array(analyser.fftSize);
    state.audioCache = {
      crack: createAudioNoiseBuffer(ac, 1.35, "white"),
      debris: createAudioNoiseBuffer(ac, 4.2, "white"),
      rumble: createAudioNoiseBuffer(ac, 13.5, "brown")
    };
    canvas.dataset.audioEngine = "hrtf-6layer";
    canvas.dataset.audioState = ac.state;
    ac.onstatechange = () => { canvas.dataset.audioState = ac.state; };

    const windSource = ac.createBufferSource();
    const windFilter = ac.createBiquadFilter();
    const windGain = ac.createGain();
    windSource.buffer = state.audioCache.crack;
    windSource.loop = true;
    windFilter.type = "bandpass";
    windFilter.Q.value = .55;
    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    windSource.start();

    const citySource = ac.createBufferSource();
    const cityFilter = ac.createBiquadFilter();
    const cityGain = ac.createGain();
    citySource.buffer = state.audioCache.rumble;
    citySource.loop = true;
    cityFilter.type = "lowpass";
    cityFilter.frequency.value = 135;
    citySource.connect(cityFilter);
    cityFilter.connect(cityGain);
    cityGain.connect(master);
    citySource.start();
    state.ambientAudio = { windSource, windFilter, windGain, citySource, cityFilter, cityGain };
    updateAmbientAudioProfile();
    updateAudioListener();
    return ac;
  }

  function setAudioButtonState() {
    const active = state.audioEnabled && state.audioUnlocked;
    ui.audioBtn.classList.toggle("muted", !state.audioEnabled);
    ui.audioBtn.classList.toggle("needs-unlock", state.audioEnabled && !state.audioUnlocked);
    ui.audioBtn.classList.toggle("audio-live", active);
    ui.audioBtn.setAttribute("aria-pressed", String(active));
    ui.audioBtn.title = !state.audioEnabled ? "开启沉浸声场" : active ? "关闭沉浸声场" : "点击解锁沉浸声场";
    canvas.dataset.audioUnlocked = String(state.audioUnlocked);
  }

  function playAudioConfirmation() {
    const ac = state.audioContext;
    if (!ac || ac.state !== "running" || !state.masterGain) return;
    const start = ac.currentTime + .012;
    const oscillator = ac.createOscillator();
    const gain = ac.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(164, start);
    oscillator.frequency.exponentialRampToValueAtTime(82, start + .2);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.linearRampToValueAtTime(.18, start + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, start + .24);
    oscillator.connect(gain);
    gain.connect(state.masterGain);
    oscillator.start(start);
    oscillator.stop(start + .26);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  function unlockAudio(withConfirmation = false) {
    if (!state.audioEnabled) {
      setAudioButtonState();
      return Promise.resolve(null);
    }
    const ac = initAudio();
    if (!ac) {
      addLog("当前浏览器不支持 Web Audio 声场", "alert");
      return Promise.resolve(null);
    }
    if (state.audioUnlocked && ac.state === "running") {
      if (withConfirmation) playAudioConfirmation();
      return Promise.resolve(ac);
    }
    if (!state.audioUnlockPromise) {
      state.audioUnlockPromise = ac.resume().then(() => {
        state.audioUnlocked = ac.state === "running";
        canvas.dataset.audioState = ac.state;
        setAudioButtonState();
        if (state.audioUnlocked) {
          addLog("沉浸声场已解锁", "ok");
          if (withConfirmation) playAudioConfirmation();
        } else addLog("浏览器阻止了声音，请点击顶部扬声器", "alert");
        return ac;
      }).catch(() => {
        state.audioUnlocked = false;
        setAudioButtonState();
        addLog("声音解锁失败，请检查标签页是否静音", "alert");
        return null;
      }).finally(() => { state.audioUnlockPromise = null; });
    }
    return state.audioUnlockPromise;
  }

  function updateAmbientAudioProfile() {
    const ac = state.audioContext;
    const ambient = state.ambientAudio;
    if (!ac || !ambient) return;
    const now = ac.currentTime;
    const profile = state.environment === "desert"
      ? { wind: .019, low: .005, frequency: 470 }
      : state.environment === "coast"
        ? { wind: .015, low: .008, frequency: 390 }
        : { wind: .008, low: .013, frequency: 310 };
    ambient.windGain.gain.setTargetAtTime(profile.wind, now, .35);
    ambient.cityGain.gain.setTargetAtTime(profile.low, now, .35);
    ambient.windFilter.frequency.setTargetAtTime(profile.frequency, now, .35);
  }

  function updateAudioListener() {
    const ac = state.audioContext;
    if (!ac) return;
    const listener = ac.listener;
    camera.getWorldDirection(audioForward);
    audioUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const now = ac.currentTime;
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(camera.position.x, now, .015);
      listener.positionY.setTargetAtTime(camera.position.y, now, .015);
      listener.positionZ.setTargetAtTime(camera.position.z, now, .015);
      listener.forwardX.setTargetAtTime(audioForward.x, now, .015);
      listener.forwardY.setTargetAtTime(audioForward.y, now, .015);
      listener.forwardZ.setTargetAtTime(audioForward.z, now, .015);
      listener.upX.setTargetAtTime(audioUp.x, now, .015);
      listener.upY.setTargetAtTime(audioUp.y, now, .015);
      listener.upZ.setTargetAtTime(audioUp.z, now, .015);
    } else {
      listener.setPosition(camera.position.x, camera.position.y, camera.position.z);
      listener.setOrientation(audioForward.x, audioForward.y, audioForward.z, audioUp.x, audioUp.y, audioUp.z);
    }
  }

  function stopAudioVoice(voice) {
    if (!voice || voice.stopped) return;
    voice.stopped = true;
    clearTimeout(voice.cleanupTimer);
    for (const source of voice.sources) {
      try { source.stop(); } catch (error) { /* source already ended */ }
      try { source.disconnect(); } catch (error) { /* already disconnected */ }
    }
    for (const node of voice.nodes) {
      try { node.disconnect(); } catch (error) { /* already disconnected */ }
    }
    const index = state.audioVoices.indexOf(voice);
    if (index >= 0) state.audioVoices.splice(index, 1);
    canvas.dataset.audioVoices = String(state.audioVoices.length);
  }

  function stopAllAudioVoices() {
    [...state.audioVoices].forEach(stopAudioVoice);
  }

  function scheduleGain(gain, start, peak, attack, end, sustain = peak * .42) {
    gain.cancelScheduledValues(start);
    gain.setValueAtTime(.0001, start);
    gain.linearRampToValueAtTime(Math.max(.0002, peak), start + attack);
    gain.exponentialRampToValueAtTime(Math.max(.0002, sustain), Math.min(end - .08, start + Math.max(attack + .08, (end - start) * .23)));
    gain.exponentialRampToValueAtTime(.0001, end);
  }

  function playExplosionAudio(blast) {
    if (!state.audioEnabled) return;
    const ac = initAudio();
    if (!ac || !state.audioCache) return;
    if (ac.state !== "running") {
      unlockAudio(false).then((ready) => { if (ready?.state === "running") playExplosionAudio(blast); });
      return;
    }
    state.audioUnlocked = true;
    setAudioButtonState();
    updateAudioListener();

    while (state.audioVoices.length >= 6) stopAudioVoice(state.audioVoices[0]);
    blastCenter.set(blast.position.x, blast.originY, blast.position.z);
    const distance = Math.max(1, cameraWorldPosition.distanceTo(blastCenter));
    const propagationDelay = clamp(distance / 343, .015, 8);
    const start = ac.currentTime + propagationDelay;
    const yieldLog = Math.log10(Math.max(10, blast.yieldKt));
    const perceived = clamp(.58 + yieldLog * .105, .65, 1.34);
    const groundCoupling = clamp(1 - blast.heightMeters / 4800, .22, 1);
    const duration = blast.giantYield ? 13 : 9.5 + yieldLog * .32;

    const voice = { sources: [], nodes: [], stopped: false, cleanupTimer: 0 };
    state.audioVoices.push(voice);
    canvas.dataset.audioVoices = String(state.audioVoices.length);
    const voiceBus = ac.createGain();
    const panner = ac.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = clamp(550 + Math.pow(blast.yieldKt / 100, .1) * 650, 850, 3600);
    panner.maxDistance = 120000;
    panner.rolloffFactor = .34;
    panner.coneInnerAngle = 360;
    if (panner.positionX) {
      panner.positionX.value = blast.position.x;
      panner.positionY.value = blast.originY;
      panner.positionZ.value = blast.position.z;
    } else panner.setPosition(blast.position.x, blast.originY, blast.position.z);
    voiceBus.gain.value = perceived;
    voiceBus.connect(panner);
    panner.connect(state.masterGain);

    const wetSend = ac.createGain();
    wetSend.gain.value = state.environment === "coast" ? .24 : state.environment === "city" ? .2 : .13;
    panner.connect(wetSend);
    wetSend.connect(state.audioReverb);

    const echoDelay = ac.createDelay(2.5);
    const echoFeedback = ac.createGain();
    const echoReturn = ac.createGain();
    echoDelay.delayTime.value = state.environment === "desert" ? .78 : state.environment === "coast" ? .58 : .43;
    echoFeedback.gain.value = state.environment === "city" ? .2 : .14;
    echoReturn.gain.value = state.environment === "city" ? .16 : .1;
    panner.connect(echoDelay);
    echoDelay.connect(echoFeedback);
    echoFeedback.connect(echoDelay);
    echoDelay.connect(echoReturn);
    echoReturn.connect(state.masterGain);
    voice.nodes.push(voiceBus, panner, wetSend, echoDelay, echoFeedback, echoReturn);

    // Supersonic pressure edge: a bright, nearly instantaneous crack.
    const crack = ac.createBufferSource();
    const crackHigh = ac.createBiquadFilter();
    const crackLow = ac.createBiquadFilter();
    const crackGain = ac.createGain();
    crack.buffer = state.audioCache.crack;
    crackHigh.type = "highpass"; crackHigh.frequency.value = 115;
    crackLow.type = "lowpass"; crackLow.frequency.setValueAtTime(6500, start); crackLow.frequency.exponentialRampToValueAtTime(900, start + .8);
    scheduleGain(crackGain.gain, start, .7, .004, start + .92, .12);
    crack.connect(crackHigh); crackHigh.connect(crackLow); crackLow.connect(crackGain); crackGain.connect(voiceBus);
    crack.start(start); crack.stop(start + 1.1);
    voice.sources.push(crack); voice.nodes.push(crackHigh, crackLow, crackGain);

    // Long pressure roar, built from brown noise and a descending low-pass.
    const roar = ac.createBufferSource();
    const roarFilter = ac.createBiquadFilter();
    const roarGain = ac.createGain();
    roar.buffer = state.audioCache.rumble;
    roar.playbackRate.value = clamp(.82 + yieldLog * .018, .84, .98);
    roarFilter.type = "lowpass";
    roarFilter.frequency.setValueAtTime(1750 + yieldLog * 85, start);
    roarFilter.frequency.exponentialRampToValueAtTime(62, start + duration);
    roarFilter.Q.value = .72;
    scheduleGain(roarGain.gain, start + .018, .68, .075, start + duration, .4);
    roar.connect(roarFilter); roarFilter.connect(roarGain); roarGain.connect(voiceBus);
    roar.start(start); roar.stop(start + duration);
    voice.sources.push(roar); voice.nodes.push(roarFilter, roarGain);

    // Sub-bass pressure modes supply the physical chest impact without clipping.
    [27, 41, 58].forEach((frequency, index) => {
      const oscillator = ac.createOscillator();
      const subGain = ac.createGain();
      oscillator.type = index === 1 ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency * (1 + yieldLog * .028), start);
      oscillator.frequency.exponentialRampToValueAtTime(17 + index * 3, start + 5.8 + index * .8);
      scheduleGain(subGain.gain, start + index * .018, (.36 / (index + 1)) * groundCoupling, .026, start + 6.2 + index * .7, .14 / (index + 1));
      oscillator.connect(subGain); subGain.connect(voiceBus);
      oscillator.start(start); oscillator.stop(start + 6.5 + index * .7);
      voice.sources.push(oscillator); voice.nodes.push(subGain);
    });

    // City fabric and rubble arrive just behind the pressure front as irregular bursts.
    const debris = ac.createBufferSource();
    const debrisFilter = ac.createBiquadFilter();
    const debrisGain = ac.createGain();
    debris.buffer = state.audioCache.debris;
    debrisFilter.type = "bandpass";
    debrisFilter.frequency.value = state.environment === "city" ? 920 : 610;
    debrisFilter.Q.value = .68;
    debrisGain.gain.setValueAtTime(.0001, start);
    const debrisAmount = (state.environment === "city" ? .19 : .1) * groundCoupling;
    for (let index = 0; index < 18; index++) {
      const burstTime = start + .18 + index * (.14 + Math.random() * .035);
      debrisGain.gain.setValueAtTime(.0001, burstTime);
      debrisGain.gain.linearRampToValueAtTime(debrisAmount * (.3 + Math.random() * .7), burstTime + .009);
      debrisGain.gain.exponentialRampToValueAtTime(.0001, burstTime + .085 + Math.random() * .05);
    }
    debris.connect(debrisFilter); debrisFilter.connect(debrisGain); debrisGain.connect(voiceBus);
    debris.start(start + .16); debris.stop(start + 4.1);
    voice.sources.push(debris); voice.nodes.push(debrisFilter, debrisGain);

    // The faster ground-coupled arrival makes distant detonations perceptible
    // before the slower airborne pressure front reaches the camera.
    const groundStart = ac.currentTime + clamp(distance / 3000, .012, 2.5);
    const groundPulse = ac.createBufferSource();
    const groundFilter = ac.createBiquadFilter();
    const groundGain = ac.createGain();
    groundPulse.buffer = state.audioCache.rumble;
    groundFilter.type = "bandpass";
    groundFilter.frequency.value = 105;
    groundFilter.Q.value = .62;
    scheduleGain(groundGain.gain, groundStart, .24 * groundCoupling, .018, groundStart + 1.55, .08 * groundCoupling);
    groundPulse.connect(groundFilter); groundFilter.connect(groundGain); groundGain.connect(voiceBus);
    groundPulse.start(groundStart); groundPulse.stop(groundStart + 1.7);
    voice.sources.push(groundPulse); voice.nodes.push(groundFilter, groundGain);

    blast.soundDelay = propagationDelay;
    canvas.dataset.soundDelay = propagationDelay.toFixed(2);
    addLog(`地震耦合声先抵达，主声浪约 ${propagationDelay.toFixed(1)} 秒后抵达`, "ok");
    voice.cleanupTimer = setTimeout(() => stopAudioVoice(voice), (propagationDelay + duration + 2.8) * 1000);
  }

  function updateAudioMeter() {
    if (!state.audioAnalyser || !state.audioMeterData) return;
    state.audioAnalyser.getByteTimeDomainData(state.audioMeterData);
    let peak = 0;
    for (const sample of state.audioMeterData) peak = Math.max(peak, Math.abs(sample - 128) / 128);
    state.audioMeterPeak = Math.max(peak, state.audioMeterPeak * .93);
    canvas.dataset.audioPeak = state.audioMeterPeak.toFixed(3);
    ui.audioBtn.style.setProperty("--audio-level", String(clamp(state.audioMeterPeak * 2.8, 0, 1)));
  }

  function tuneRenderScale(now) {
    state.performanceFrames++;
    const elapsed = now - state.performanceLast;
    if (elapsed < 1250) return;
    const fps = state.performanceFrames * 1000 / elapsed;
    state.lastFps = fps;
    canvas.dataset.fps = fps.toFixed(1);
    const giantActive = state.blasts.some((blast) => blast.giantYield);
    const maxScale = giantActive ? .7 : Math.min(window.devicePixelRatio || 1, 1.5);
    let next = state.renderScale;
    if (fps < 48) next = Math.max(.42, next - .12);
    else if (fps > 57 && state.blasts.length < 5) next = Math.min(maxScale, next + .07);
    next = Math.min(next, maxScale);
    if (Math.abs(next - state.renderScale) > .04) {
      state.renderScale = next;
      resize();
      for (const blast of state.blasts) {
        blast.dust.material.uniforms.uPixelRatio.value = next;
        blast.embers.material.uniforms.uPixelRatio.value = next;
      }
    }
    canvas.dataset.renderScale = state.renderScale.toFixed(2);
    canvas.dataset.physics = state.physicsWorkerReady ? "worker" : "main";
    state.performanceFrames = 0;
    state.performanceLast = now;
  }

  function animate(now){
    const delta=Math.min(.05,(now-state.lastFrame)/1000);state.lastFrame=now;
    state.animationFrame++;
    updateBlasts(delta);updateCamera(delta);
    if(now-state.uiLast>90){updateTelemetry();drawWave();state.uiLast=now;}
    if(state.animationFrame%3===0)updateAudioMeter();
    if(renderer.shadowMap.enabled&&state.animationFrame%4===0)renderer.shadowMap.needsUpdate=true;
    tuneRenderScale(now);renderer.render(scene,camera);requestAnimationFrame(animate);
  }

  ui.yieldRange.addEventListener("input",updateControls);ui.heightRange.addEventListener("input",updateControls);ui.intervalRange.addEventListener("input",updateControls);
  $$("[data-yield]").forEach(button=>button.addEventListener("click",()=>{ui.yieldRange.value=String(sliderFromYield(+button.dataset.yield));updateControls();}));
  $$("[data-scene]").forEach(button=>button.addEventListener("click",()=>{$$("[data-scene]").forEach(item=>item.classList.remove("active"));button.classList.add("active");state.environment=button.dataset.scene;ui.sceneLabel.textContent=environments[state.environment].label;ui.windLabel.textContent=`WIND ${environments[state.environment].wind} KM/H →`;clearSandbox();}));
  ui.continuousToggle.addEventListener("click",()=>{if(state.sequenceActive)triggerDeployment();state.continuous=!state.continuous;ui.continuousToggle.classList.toggle("active",state.continuous);ui.continuousToggle.setAttribute("aria-pressed",String(state.continuous));ui.sequenceState.textContent=state.continuous?"ARMED":"SINGLE";ui.detonateText.textContent=state.continuous?"启动连续爆破":"立即投放核爆";ui.detonateHint.textContent=state.continuous?"AUTO DEPLOYMENT":"INSTANT DEPLOYMENT";});
  ui.detonateBtn.addEventListener("click",async()=>{await unlockAudio(false);triggerDeployment();});
  ui.pauseBtn.addEventListener("click",()=>{state.paused=!state.paused;ui.pauseBtn.querySelector("span").textContent=state.paused?"▶":"Ⅱ";ui.systemStatus.textContent=withPhysicsMode(state.paused?"SANDBOX PAUSED":state.sequenceActive?"CONTINUOUS DEPLOYMENT ACTIVE":"3D SANDBOX LIVE");if(state.audioContext){if(state.paused)state.audioContext.suspend();else if(state.audioEnabled)state.audioContext.resume();}});
  ui.clearBtn.addEventListener("click",clearSandbox);
  ui.speedBtn.addEventListener("click",()=>{const speeds=[1,.5,.25];state.speed=speeds[(speeds.indexOf(state.speed)+1)%speeds.length];ui.speedBtn.textContent=`${state.speed}×`;});
  ui.audioBtn.addEventListener("click",async()=>{
    if (!state.audioUnlocked) {
      state.audioEnabled = true;
      const ac = initAudio();
      if (state.masterGain && ac) state.masterGain.gain.setTargetAtTime(.9, ac.currentTime, .045);
      await unlockAudio(true);
      return;
    }
    state.audioEnabled = !state.audioEnabled;
    const ac = initAudio();
    if (state.masterGain && ac) state.masterGain.gain.setTargetAtTime(state.audioEnabled ? .9 : 0, ac.currentTime, .045);
    if (state.audioEnabled) await unlockAudio(true);
    setAudioButtonState();
  });
  ui.helpBtn.addEventListener("click",()=>ui.helpDialog.showModal());$("#closeHelp").addEventListener("click",()=>ui.helpDialog.close());ui.helpDialog.addEventListener("click",event=>{if(event.target===ui.helpDialog)ui.helpDialog.close();});

  canvas.addEventListener("pointerdown",event=>{state.dragging=true;state.dragged=false;state.dragStartX=state.lastPointerX=event.clientX;state.dragStartY=state.lastPointerY=event.clientY;canvas.setPointerCapture(event.pointerId);});
  canvas.addEventListener("pointermove",event=>{if(!state.dragging)return;const dx=event.clientX-state.lastPointerX,dy=event.clientY-state.lastPointerY;if(Math.hypot(event.clientX-state.dragStartX,event.clientY-state.dragStartY)>4)state.dragged=true;if(state.dragged){state.camera.theta-=dx*.006;state.camera.phi=clamp(state.camera.phi-dy*.005,.18,2.82);}state.lastPointerX=event.clientX;state.lastPointerY=event.clientY;});
  canvas.addEventListener("pointerup",event=>{if(!state.dragged)pickGround(event);state.dragging=false;canvas.releasePointerCapture(event.pointerId);});
  canvas.addEventListener("wheel",event=>{event.preventDefault();state.camera.radius=clamp(state.camera.radius*Math.exp(event.deltaY*.001),18,12000);},{passive:false});
  window.addEventListener("keydown",event=>{if(["KeyW","KeyA","KeyS","KeyD","KeyQ","KeyE","ShiftLeft","ShiftRight"].includes(event.code)){state.keys.add(event.code);if(document.activeElement===document.body)event.preventDefault();}if(event.code==="Space"&&!event.repeat&&document.activeElement?.tagName!=="INPUT"){event.preventDefault();unlockAudio(false).then(triggerDeployment);}if(event.code==="KeyC"&&!event.repeat)clearSandbox();if(event.code==="KeyP"&&!event.repeat)ui.pauseBtn.click();});
  window.addEventListener("keyup",event=>state.keys.delete(event.code));window.addEventListener("blur",()=>state.keys.clear());window.addEventListener("resize",resize);

  setAudioButtonState();updateControls();buildEnvironment();resize();updateCamera(0);setInterval(renderGrain,220);requestAnimationFrame(animate);
})();
