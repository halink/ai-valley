// Original procedural painted-color study, MIT, 2026 AI Valley contributors.
// Static opaque color only: no displacement, transparency or simulation state.
shader_type spatial;
render_mode diffuse_burley, specular_disabled;
uniform vec4 pigment : source_color = vec4(0.5, 0.5, 0.5, 1.0);
uniform int surface_kind = 0; // 0 tile, 1 timber, 2 water, 3 planks, 4 cloth, 5 cultivated soil
varying vec3 world_point;
varying vec3 world_normal;
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wash(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash21(cell),hash21(cell+vec2(1,0)),f.x),
        mix(hash21(cell+vec2(0,1)),hash21(cell+vec2(1,1)),f.x),f.y);
}
void vertex() {
    world_point = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
    world_normal = normalize(MODEL_NORMAL_MATRIX * NORMAL);
}
float paint(vec2 p) {
    // Broad pigment washes; restrained contrast so residents stay the focal point.
    float mark = (wash(p*vec2(2.8,1.3))-0.5)*0.10;
    if (surface_kind == 1) {
        float grain = sin(p.x*28.0 + wash(p*vec2(2.6,0.47))*6.0);
        mark += grain*0.012 + (wash(p*vec2(5.0,0.37))-0.5)*0.065;
    } else if (surface_kind == 2) {
        // Painted ripples, not a fabricated flowing-water simulation.
        float stroke = sin(p.y*7.0 + wash(p*vec2(.6, .23))*4.0);
        float broken = smoothstep(.25, .75, wash(p*vec2(.7, 1.2)));
        mark = (wash(p*.32)-.5)*.10 + smoothstep(.82,1.0,stroke)*broken*.04;
    }
    return mark;
}
float tile(vec2 uv) {
    float jitter = wash(uv * .66) - .5;
    vec2 q = uv + vec2(jitter * .13, jitter * .16);
    q.y += mod(floor(q.x), 2.0) * .12;
    vec2 f = fract(q);
    vec2 blur = max(fwidth(q), vec2(.018));
    // Unglazed pan tiles have a wide concave pan and a narrow raised roll.
    float roll = smoothstep(.64, .91, f.x) * (1.0 - smoothstep(.95, 1.0, f.x));
    float trough = 1.0 - smoothstep(0.0, .12 + blur.x, min(f.x, 1.0 - f.x));
    float lap = 1.0 - smoothstep(.022, .095 + blur.y, f.y);
    float signal = (hash21(floor(q)) - .5) * .062 + (roll * .062 - trough * .064 - lap * .064);
    return signal * (1.0 - smoothstep(.15, .9, max(blur.x, blur.y))) + jitter * .065
        + (wash(uv * .14) - .5) * .065;
}
float planks(vec2 point) {
    float row = floor(point.y * 2.5);
    vec2 q = vec2(point.x * .32 + hash21(vec2(row, 7.0)), point.y * 2.5);
    vec2 f = fract(q);
    float joints = 1.0 - smoothstep(.017, .046, min(f.x * 1.5, f.y));
    float grain = wash(vec2(point.x * 1.1, point.y * 17.0));
    return (hash21(floor(q)) - .5) * .078 + (grain - .5) * .042 - joints * .10;
}
void fragment() {
    vec3 weights = pow(abs(normalize(world_normal)),vec3(8.0));
    weights /= max(dot(weights,vec3(1.0)),0.0001);
    float marks = paint(world_point.zy)*weights.x + paint(world_point.xz)*weights.y + paint(world_point.xy)*weights.z;
    if (surface_kind == 0) {
        marks = tile(UV);
    } else if (surface_kind == 3) {
        marks = planks(world_point.xz) * weights.y + marks * (1.0 - weights.y);
    } else if (surface_kind == 4) {
        vec2 thread = world_point.xz * vec2(72.0, 69.0);
        float detail = 1.0 - smoothstep(.25, .8, max(fwidth(thread).x, fwidth(thread).y));
        marks = marks * .65 + sin(thread.x) * sin(thread.y) * .026 * detail;
    } else if (surface_kind == 5) {
        float rows = sin((UV.x * 3.0 + wash(UV * 3.0) * .13) * 6.283);
        marks = rows * .058 + (wash(UV * vec2(60.0, 23.0)) - .5) * .065;
    }
    vec3 base = surface_kind == 2 ? pigment.rgb * 0.78 : pigment.rgb;
    ALBEDO = clamp(base + vec3(marks),vec3(0.0),vec3(1.0));
    ROUGHNESS = 1.0;
    METALLIC = 0.0;
}
