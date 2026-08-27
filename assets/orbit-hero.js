(function(){
  const canvas = document.getElementById('orbit-gl');
  if (!canvas) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!window.THREE) { console.error('three.js failed to load'); return; }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 6.2;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({canvas, alpha:true, antialias:true});
  } catch(e) { console.error('WebGL unavailable', e); return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const BALL = new THREE.Group(); scene.add(BALL);
  window.__ballRef = BALL;   // debug handle for automated speed checks

  const C_TEAL  = new THREE.Color(0x00B48E);
  const C_AQUA  = new THREE.Color(0x87E9E7);
  const C_GREEN = new THREE.Color(0x8EC66C);
  const C_SLATE = new THREE.Color(0x5B8196);

  const R = 2.15;
  const COUNT = 15000;

  /* ============================================================
     TRUNCATED ICOSAHEDRON — the actual modern football solid.
     12 pentagons + 20 hexagons = 32 panels.
     Built from an icosahedron: every face becomes a hexagon,
     every vertex becomes a pentagon.
     ============================================================ */
  const ico = new THREE.IcosahedronGeometry(R, 0);
  const tris = [];
  {
    const p = ico.attributes.position;
    for (let i = 0; i < p.count; i += 3){
      tris.push([
        new THREE.Vector3(p.getX(i),   p.getY(i),   p.getZ(i)),
        new THREE.Vector3(p.getX(i+1), p.getY(i+1), p.getZ(i+1)),
        new THREE.Vector3(p.getX(i+2), p.getY(i+2), p.getZ(i+2))
      ]);
    }
  }
  ico.dispose();

  // 12 icosahedron vertices -> pentagon centres
  const pentCentres = [];
  tris.flat().forEach(v => {
    if (!pentCentres.some(u => u.distanceToSquared(v) < 1e-6)) pentCentres.push(v.clone());
  });
  // 20 face centroids -> hexagon centres
  const hexCentres = tris.map(t =>
    t[0].clone().add(t[1]).add(t[2]).divideScalar(3).setLength(R));

  // Spherical Voronoi over these 32 seeds reproduces the panel layout.
  // Pentagons get a small additive bias: on a real truncated icosahedron the
  // pentagons are SMALLER than the hexagons, and an unweighted Voronoi would
  // hand them ~35% of the surface instead of the true ~25.6%. Solved empirically.
  const PENT_BIAS = 0.027;
  const seeds = [
    ...pentCentres.map(v => ({dir: v.clone().normalize(), pent: true,  bias: PENT_BIAS})),
    ...hexCentres .map(v => ({dir: v.clone().normalize(), pent: false, bias: 0}))
  ];

  // returns {gap, pent} — gap ~0 means the point sits on a seam
  function panelAt(dir){
    let b1 = -Infinity, b2 = -Infinity, pent = false;
    for (const s of seeds){
      const d = dir.dot(s.dir) - s.bias;
      if (d > b1){ b2 = b1; b1 = d; pent = s.pent; }
      else if (d > b2){ b2 = d; }
    }
    return {gap: b1 - b2, pent};
  }

  // --- particles, coloured by which panel they fall in ---
  const pos = new Float32Array(COUNT*3);
  const col = new Float32Array(COUNT*3);
  const dir = new THREE.Vector3();
  const C_PENT = C_AQUA.clone();
  const C_HEX  = C_TEAL.clone().lerp(C_SLATE, .35);
  let n = 0;
  for (let i = 0; i < COUNT; i++){
    const phi = Math.acos(1 - 2*(i+0.5)/COUNT);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    dir.set(Math.cos(theta)*Math.sin(phi), Math.sin(theta)*Math.sin(phi), Math.cos(phi));

    const {gap, pent} = panelAt(dir);
    const onSeam = gap < 0.028;
    if (onSeam) continue;                  // leave the seam as a clean gap

    // faint brain folding inside each panel — the "mind" in the ball
    const fold = Math.sin(dir.x*5.5)*Math.cos(dir.y*5.5)*Math.sin(dir.z*5.5);
    const r = R * (1 + fold*0.018);

    pos[n*3] = dir.x*r; pos[n*3+1] = dir.y*r; pos[n*3+2] = dir.z*r;

    // pentagons read brighter, hexagons sit back; folds tint toward green
    let c = (pent ? C_PENT : C_HEX).clone();
    if (fold > 0.3) c.lerp(C_GREEN, .55);
    c.multiplyScalar(pent ? 1 : 0.78);

    col[n*3] = c.r; col[n*3+1] = c.g; col[n*3+2] = c.b;
    n++;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.slice(0,n*3), 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(col.slice(0,n*3), 3));
  const mat = new THREE.PointsMaterial({
    size:0.019, vertexColors:true, transparent:true, opacity:.9,
    blending:THREE.AdditiveBlending, depthWrite:false
  });
  BALL.add(new THREE.Points(geo, mat));

  // debug hook — lets automated checks read the real baked geometry
  window.__mbfDebug = () => ({
    colors: geo.attributes.color.array,
    count: geo.attributes.color.count,
    seeds: seeds.length,
    pentSeeds: seeds.filter(s=>s.pent).length
  });

  /* --- PANEL OUTLINES -------------------------------------------------
     Each icosahedron face gives one hexagon: cut every edge at 1/3 and
     2/3. Drawing all 20 hexagons traces the complete seam network, and
     the 12 pentagons appear automatically as the gaps between them.
     Drawn as tubes so the seams have real weight on screen.
  --------------------------------------------------------------------- */
  const SEAM_R = R * 1.012;
  const seamMat = new THREE.MeshBasicMaterial({
    color:0x87E9E7, transparent:true, opacity:.62,
    blending:THREE.AdditiveBlending, depthWrite:false
  });
  const seamTubes = [];
  tris.forEach(([A,B,C]) => {
    const corners = [
      A.clone().lerp(B, 1/3), A.clone().lerp(B, 2/3),
      B.clone().lerp(C, 1/3), B.clone().lerp(C, 2/3),
      C.clone().lerp(A, 1/3), C.clone().lerp(A, 2/3)
    ].map(v => v.setLength(SEAM_R));

    // subdivide each edge so the seam hugs the sphere instead of cutting it
    const pts = [];
    for (let i = 0; i < 6; i++){
      const a = corners[i], b = corners[(i+1)%6];
      for (let s = 0; s < 5; s++) pts.push(a.clone().lerp(b, s/5).setLength(SEAM_R));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
    const g = new THREE.TubeGeometry(curve, 54, 0.0145, 4, true);
    seamTubes.push(g);
    BALL.add(new THREE.Mesh(g, seamMat));
  });

  // pentagon faces: a subtle filled disc so the 12 pentagons read instantly
  const pentMat = new THREE.MeshBasicMaterial({
    color:0x00B48E, transparent:true, opacity:.10,
    blending:THREE.AdditiveBlending, side:THREE.DoubleSide, depthWrite:false});
  const pentGeoms = [];
  pentCentres.forEach(centre => {
    const g = new THREE.CircleGeometry(R*0.255, 5);
    pentGeoms.push(g);
    const m = new THREE.Mesh(g, pentMat);
    m.position.copy(centre.clone().setLength(R*1.005));
    m.lookAt(0,0,0);
    BALL.add(m);
  });

  // --- neural synapse arcs across the surface ---
  const SYN = 26;
  const synapses = [];
  const synMat = new THREE.LineBasicMaterial({
    color:0x8EC66C, transparent:true, opacity:.5,
    blending:THREE.AdditiveBlending
  });
  for (let i = 0; i < SYN; i++){
    const a = new THREE.Vector3().randomDirection().multiplyScalar(R);
    const b = new THREE.Vector3().randomDirection().multiplyScalar(R);
    if (a.angleTo(b) > 1.7) { b.lerp(a, .45).setLength(R); }      // keep arcs short
    const mid = a.clone().add(b).multiplyScalar(.5).setLength(R*1.22);
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const g = new THREE.BufferGeometry().setFromPoints(curve.getPoints(26));
    const line = new THREE.Line(g, synMat.clone());
    line.material.opacity = 0;
    synapses.push({line, g, t: Math.random()*Math.PI*2, speed: .6+Math.random()*1.1});
    BALL.add(line);
  }

  // --- orbit rings = movement paths ---
  const orbits = [];
  const orbitMat = new THREE.LineBasicMaterial({
    color:0x00B48E, transparent:true, opacity:.26, blending:THREE.AdditiveBlending});
  for (let i = 0; i < 5; i++){
    const rr = R*(1.14 + i*0.085), pts = [];
    for (let p = 0; p <= 120; p++){
      const a = (p/120)*Math.PI*2;
      pts.push(new THREE.Vector3(Math.cos(a)*rr, Math.sin(a)*rr, Math.sin(a*3)*0.16));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(g, orbitMat);
    line.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
    orbits.push({line, g, dir: i%2 ? 1 : -1});
    BALL.add(line);

    // travelling node on the ring
    if (i % 2 === 0){
      const nodeG = new THREE.SphereGeometry(0.032, 12, 12);
      const nodeM = new THREE.MeshBasicMaterial({color:0x87E9E7});
      const node = new THREE.Mesh(nodeG, nodeM);
      line.add(node);
      orbits[orbits.length-1].node = node;
      orbits[orbits.length-1].rr = rr;
      orbits[orbits.length-1].geoms = [nodeG]; orbits[orbits.length-1].mats = [nodeM];
    }
  }

  // --- pointer / drag interaction ---
  const target = {x:0, y:0};
  const cur = {x:0, y:0};
  let dragging = false, lastX = 0, spin = 0;

  addEventListener('pointermove', e => {
    const nx = (e.clientX / innerWidth) * 2 - 1;
    const ny = (e.clientY / innerHeight) * 2 - 1;
    target.y = nx * 0.42;
    target.x = ny * 0.30;
    if (dragging) { spin += (e.clientX - lastX) * 0.006; lastX = e.clientX; }
  }, {passive:true});
  canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX;
    canvas.style.cursor='grabbing'; });
  addEventListener('pointerup', () => { dragging = false; canvas.style.cursor='grab'; });
  canvas.style.cursor = 'grab';

  let scrollBoost = 0, lastScroll = scrollY;
  addEventListener('scroll', () => {
    // gentle nudge only, and hard-capped so fast scrolling can't spin it up
    scrollBoost = Math.min(scrollBoost + Math.abs(scrollY - lastScroll) * 0.00016, .0035);
    lastScroll = scrollY;
  }, {passive:true});

  function resize(){
    const w = canvas.clientWidth, h = canvas.clientHeight;
    camera.aspect = w / Math.max(1,h); camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    if (w >= 1024){ BALL.position.set(2.25, 0.05, 0); BALL.scale.setScalar(.8); camera.position.z = 7.9; }
    else          { BALL.position.set(0, 2.15, 0); BALL.scale.setScalar(.62); camera.position.z = 8.6; }
  }
  addEventListener('resize', resize); resize();

  const tmpV = new THREE.Vector3();
  let t = 0, raf, lastT = performance.now();

  // Calm, readable idle speed: ~4°/sec => one full revolution every ~90s.
  // Expressed per-second and multiplied by delta time, so a 120Hz display
  // spins at the same rate as a 60Hz one instead of double speed.
  const IDLE_SPIN = 0.070;   // radians per second

  function frame(){
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min((now - lastT) / 1000, 0.05);   // clamp after tab-switch
    lastT = now;
    t += dt;
    scrollBoost *= 0.94;

    cur.x += (target.x - cur.x) * 0.045;
    cur.y += (target.y - cur.y) * 0.045;

    BALL.rotation.x = cur.x;
    BALL.rotation.y += (IDLE_SPIN + scrollBoost * 60) * dt + spin;
    BALL.rotation.z = cur.y * 0.12;
    spin *= Math.pow(0.90, dt * 60);   // framerate-independent decay

    // synapses fire in sequence
    synapses.forEach(s => {
      s.t += dt * s.speed;
      const pulse = Math.max(0, Math.sin(s.t));
      s.line.material.opacity = pulse * pulse * 0.62;
    });

    // orbit nodes travel their ring — slowed to match the calmer ball
    orbits.forEach((o, i) => {
      o.line.rotation.z += 0.05 * o.dir * dt;
      if (o.node){
        const a = t * (0.20 + i*0.05) * o.dir;
        o.node.position.set(Math.cos(a)*o.rr, Math.sin(a)*o.rr, Math.sin(a*3)*0.16);
      }
    });

    renderer.render(scene, camera);
  }
  if (!reduce) frame(); else { resize(); renderer.render(scene, camera); }

  // pause when tab hidden / hero offscreen — saves battery
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else if (!reduce){ lastT = performance.now(); frame(); }   // reset clock, no jump
  });
})();
