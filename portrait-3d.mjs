import {
  CanvasTexture, InstancedBufferAttribute, InstancedBufferGeometry, BufferAttribute,
  Mesh, PerspectiveCamera, Scene, ShaderMaterial, Vector2, WebGLRenderer,
} from "three";

const vertexShader = `
  attribute vec4 originDepth;
  attribute vec4 destination;
  attribute vec4 glyph;
  uniform vec2 turn;
  uniform vec2 center;
  uniform float distanceToCamera;
  uniform float progress;
  uniform float idle;
  uniform float glyphScale;
  varying vec2 atlasUv;
  varying float alpha;

  void main() {
    float d = smoothstep(originDepth.w, 1.0, progress);
    float curl = sin(d * 3.141593) * destination.w;
    vec3 p = originDepth.xyz;
    // Compensate for focal length so the neutral view matches the 2D source.
    p.xy *= 1.0 - p.z / distanceToCamera;
    p = mix(p, destination.xyz, d);
    p.xy += vec2(44.0, -23.0) * curl;
    p.z += idle * sin(originDepth.x * .025 + originDepth.y * .018);

    float cy = cos(turn.x), sy = sin(turn.x);
    float cx = cos(turn.y), sx = sin(turn.y);
    p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
    p = vec3(p.x, cx * p.y - sx * p.z, sx * p.y + cx * p.z);
    p.xy += center;
    p.y += idle * .7;

    float size = glyph.z * glyphScale * (1.0 - d * destination.w * .45);
    p.xy += position.xy * size * (1.0 - originDepth.z / distanceToCamera);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    atlasUv = (vec2(glyph.x * 48.0 + 18.0, glyph.y * 12.0) +
      vec2(position.x + .5, .5 - position.y) * 12.0) / vec2(96.0, 48.0);
    alpha = glyph.w * (1.0 - d * (.22 + abs(destination.z) * .0015));
  }
`;

const fragmentShader = `
  uniform sampler2D digits;
  varying vec2 atlasUv;
  varying float alpha;
  void main() {
    vec4 glyph = texture2D(digits, atlasUv);
    gl_FragColor = vec4(glyph.rgb, glyph.a * alpha);
  }
`;

function bump(x, y, cx, cy, width, height) {
  return Math.exp(-(((x - cx) / width) ** 2 + ((y - cy) / height) ** 2));
}

// Hand-shaped relief for the supplied image. X and Y are normalized photo coordinates.
function depthAt(x, y, width) {
  return width * (
    .125 * bump(x, y, .45, .41, .19, .24) +
    .070 * bump(x, y, .41, .385, .048, .088) +
    .031 * bump(x, y, .45, .459, .095, .036) -
    .043 * bump(x, y, .36, .35, .056, .037) -
    .045 * bump(x, y, .51, .321, .056, .035) +
    .048 * bump(x, y, .48, .18, .27, .16) -
    .036 * bump(x, y, .65, .39, .043, .084) -
    .060 * bump(x, y, .50, .79, .45, .23)
  );
}

function createPortrait3D(canvas, atlas) {
  const gl = canvas.getContext("webgl2", {alpha: true, antialias: false, depth: false});
  if (!gl) return null;
  const renderer = new WebGLRenderer({canvas, context: gl, alpha: true});
  renderer.setClearColor(0, 0);
  const scene = new Scene();
  const camera = new PerspectiveCamera(22, 1, 1, 15000);
  const texture = new CanvasTexture(atlas);
  texture.flipY = false;
  texture.generateMipmaps = false;
  const material = new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      digits: {value: texture}, turn: {value: new Vector2()},
      center: {value: new Vector2()}, distanceToCamera: {value: 1},
      glyphScale: {value: 1}, idle: {value: 0}, progress: {value: 0},
    },
    vertexShader,
    fragmentShader,
  });
  const mesh = new Mesh(new InstancedBufferGeometry(), material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    update(layout, particles, ratio) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(layout.width, layout.height, false);
      camera.aspect = layout.width / layout.height;
      camera.position.z = layout.height / (2 * Math.tan(camera.fov * Math.PI / 360));
      camera.updateProjectionMatrix();
      material.uniforms.distanceToCamera.value = camera.position.z;
      const cx = layout.x + layout.subjectWidth / 2;
      const cy = layout.y + layout.subjectHeight / 2;
      material.uniforms.center.value.set(cx - layout.width / 2, layout.height / 2 - cy);

      const geometry = new InstancedBufferGeometry();
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      geometry.setAttribute("position", new BufferAttribute(new Float32Array([
        -.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0,
      ]), 3));
      const origins = new Float32Array(particles.length * 4);
      const destinations = new Float32Array(origins.length);
      const glyphs = new Float32Array(origins.length);
      particles.forEach((particle, index) => {
        const {originalX: x, originalY: y} = particle;
        const offset = index * 4;
        const depth = depthAt(x, y, layout.subjectWidth);
        const dispersionDepth = (Math.sin(index * 2.399963) * .34 + particle.curl * .30) * layout.subjectWidth;
        origins.set([(x - .5) * layout.subjectWidth, (.5 - y) * layout.subjectHeight, depth, particle.delay], offset);
        destinations.set([particle.targetX - cx, cy - particle.targetY, dispersionDepth, particle.curl], offset);
        glyphs.set([particle.digit, particle.shade, particle.size, particle.opacity], offset);
      });
      geometry.setAttribute("originDepth", new InstancedBufferAttribute(origins, 4));
      geometry.setAttribute("destination", new InstancedBufferAttribute(destinations, 4));
      geometry.setAttribute("glyph", new InstancedBufferAttribute(glyphs, 4));
      geometry.instanceCount = particles.length;
      mesh.geometry.dispose();
      mesh.geometry = geometry;
    },
    render(progress, yaw, pitch, idle, size) {
      material.uniforms.progress.value = progress;
      material.uniforms.turn.value.set(yaw, pitch);
      material.uniforms.idle.value = idle;
      material.uniforms.glyphScale.value = size;
      renderer.render(scene, camera);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
      renderer.dispose();
    },
  };
}

window.createPortrait3D = createPortrait3D;
