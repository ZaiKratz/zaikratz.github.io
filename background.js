(() => {
  const layer = document.querySelector('.ambient-background');
  if (!layer) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'nebula-canvas';
  const gl = canvas.getContext('webgl', {
    alpha: false, antialias: false, depth: false, stencil: false,
    powerPreference: 'low-power',
  });
  if (!gl) return;
  layer.append(canvas);

  const vertexSource = `
    attribute vec2 a_position;
    void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
  `;
  const fragmentSource = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
    #else
      precision mediump float;
    #endif
    uniform vec2 u_resolution;
    uniform float u_time;

    float hash(vec2 p) {
      vec3 q = fract(vec3(p.xyx) * 0.1031);
      q += dot(q, q.yzx + 33.33);
      return fract((q.x + q.y) * q.z);
    }
    float noise(vec2 p) {
      vec2 cell = floor(p);
      vec2 f = fract(p);
      vec2 blend = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(cell), hash(cell + vec2(1.0, 0.0)), blend.x),
        mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), blend.x),
        blend.y
      );
    }
    float fbm(vec2 p) {
      float sum = 0.0;
      float amplitude = 0.54;
      mat2 rotation = mat2(0.8, -0.6, 0.6, 0.8);
      for (int octave = 0; octave < 5; octave++) {
        sum += amplitude * noise(p);
        p = rotation * p * 2.03 + vec2(7.1, 3.8);
        amplitude *= 0.48;
      }
      return sum;
    }
    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution;
      vec2 p = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0) * 3.0;
      float t = u_time * 0.07;
      // Domain warping billows the smoke instead of moving a flat texture.
      vec2 flow = vec2(
        fbm(p + vec2(t * 0.35, -t * 0.22)),
        fbm(p + vec2(4.2, 1.3) + vec2(-t * 0.24, t * 0.18))
      );
      float curl = fbm(p + 2.8 * flow + vec2(1.7, 9.2) + t * 0.12);
      float cloud = fbm(p + 3.2 * curl + 1.4 * flow + vec2(-t * 0.2, t * 0.15));
      float density = pow(smoothstep(0.25, 0.8, cloud), 1.8);
      vec2 lightOffset = (uv - vec2(0.68, 1.04)) * vec2(1.3, 1.0);
      float light = exp(-dot(lightOffset, lightOffset) * 3.2);
      float fade = smoothstep(0.08, 0.95, uv.y);
      vec3 color = vec3(0.003, 0.009, 0.012);
      color += vec3(0.0, 0.34, 0.4) * density * (0.4 + 1.6 * light) * fade;
      color += vec3(0.015, 0.14, 0.16) * pow(cloud, 6.0) * light * fade;
      // Stable grain adds fine texture without flickering.
      color += (hash(gl_FragCoord.xy) - 0.5) * 0.004 * fade * light;
      gl_FragColor = vec4(max(color * 0.65, vec3(0.0)), 1.0);
    }
  `;

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let program;
  let resolution;
  let time;
  let frame = 0;
  let previousTime = null;
  let elapsed = 14;
  let lost = false;
  let scrolling = false;
  let scrollTimer = 0;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error('Background shader unavailable');
    }
    return shader;
  }

  function initialize() {
    const shaders = [];
    try {
      shaders.push(compile(gl.VERTEX_SHADER, vertexSource));
      shaders.push(compile(gl.FRAGMENT_SHADER, fragmentSource));
      program = gl.createProgram();
      shaders.forEach(shader => gl.attachShader(program, shader));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Background unavailable');
      gl.useProgram(program);
      const vertices = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      resolution = gl.getUniformLocation(program, 'u_resolution');
      time = gl.getUniformLocation(program, 'u_time');
      return true;
    } catch {
      if (program) gl.deleteProgram(program);
      program = null;
      return false;
    } finally {
      shaders.forEach(shader => gl.deleteShader(shader));
    }
  }

  function draw() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(resolution, canvas.width, canvas.height);
    gl.uniform1f(time, elapsed);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    canvas.classList.add('is-ready');
  }

  function resize() {
    // Cap rendering resolution; the soft mist scales smoothly to any screen.
    const width = Math.max(1, layer.clientWidth);
    const height = Math.max(1, layer.clientHeight);
    const scale = Math.min(0.5, Math.sqrt(180000 / (width * height)));
    const renderWidth = Math.max(1, Math.round(width * scale));
    const renderHeight = Math.max(1, Math.round(height * scale));
    if (canvas.width === renderWidth && canvas.height === renderHeight) return;
    canvas.width = renderWidth;
    canvas.height = renderHeight;
    if (program && !lost) draw();
  }

  function animate(timestamp) {
    frame = requestAnimationFrame(animate);
    if (previousTime === null) previousTime = timestamp;
    const delta = timestamp - previousTime;
    if (delta < 1000 / 20) return;
    elapsed += Math.min(delta, 100) / 1000;
    previousTime = timestamp;
    draw();
  }

  function updateMotion() {
    cancelAnimationFrame(frame);
    previousTime = null;
    if (!program || lost || document.hidden || scrolling) return;
    draw();
    if (!motion.matches) frame = requestAnimationFrame(animate);
  }

  // Keep the last mist frame on screen and leave rendering time for scrolling.
  function onScroll() {
    if (!scrolling) {
      scrolling = true;
      cancelAnimationFrame(frame);
      previousTime = null;
    }
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      scrolling = false;
      updateMotion();
    }, 160);
  }

  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    lost = true;
    cancelAnimationFrame(frame);
    canvas.classList.remove('is-ready');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    if (initialize()) {
      resize();
      updateMotion();
    }
  });

  if (!initialize()) return;
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('visibilitychange', updateMotion);
  motion.addEventListener('change', updateMotion);
  resize();
  updateMotion();
})();
