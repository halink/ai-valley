shader_type spatial;
render_mode diffuse_burley, specular_disabled;

uniform sampler2D tile_map : filter_nearest, repeat_disable;
uniform sampler2D meadow : source_color, filter_linear_mipmap, repeat_disable;
uniform vec2 map_size = vec2(32.0, 24.0);
varying vec2 ground;

void vertex() {
	ground = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xz + vec2(0.5);
}

float pigment_hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float pigment(vec2 p) {
	vec2 cell = floor(p);
	vec2 w = smoothstep(vec2(0.0), vec2(1.0), fract(p));
	return mix(mix(pigment_hash(cell), pigment_hash(cell + vec2(1, 0)), w.x),
		mix(pigment_hash(cell + vec2(0, 1)), pigment_hash(cell + vec2(1, 1)), w.x), w.y);
}

float kind_at(vec2 cell) {
	if (any(lessThan(cell, vec2(0.0))) || any(greaterThanEqual(cell, map_size))) {
		return 7.0;
	}
	return floor(texture(tile_map, (cell + 0.5) / map_size).r * 255.0 + 0.5);
}

float exposed_edge(vec2 cell, vec2 at, float kind) {
	float distance = 1.0;
	if (kind_at(cell + vec2(-1, 0)) != kind) { distance = min(distance, at.x); }
	if (kind_at(cell + vec2(1, 0)) != kind) { distance = min(distance, 1.0 - at.x); }
	if (kind_at(cell + vec2(0, -1)) != kind) { distance = min(distance, at.y); }
	if (kind_at(cell + vec2(0, 1)) != kind) { distance = min(distance, 1.0 - at.y); }
	return distance;
}

void fragment() {
	vec2 cell = floor(ground);
	vec2 coordinate = fract(ground);
	float kind = kind_at(cell);
	float fine = pigment(ground * vec2(10.0, 5.5)) - 0.5;
	float wash = pigment(ground * 0.90) - 0.5;
	vec3 turf = texture(meadow, ground / map_size).rgb;
	float luma = dot(turf, vec3(0.22, 0.70, 0.08));
	vec3 grass = mix(vec3(luma), turf, 0.81) * vec3(0.83, 0.89, 0.86);
	vec3 paint = grass;
	if (kind == 1.0 || kind == 5.0) {
		float edge = exposed_edge(cell, coordinate, kind);
		float soft_edge = smoothstep(0.02, 0.23, edge + wash * 0.21 + fine * 0.07);
		vec3 dust = vec3(0.66, 0.54, 0.40) + wash * 0.13 + fine * 0.035;
		paint = mix(grass, dust, soft_edge);
	} else if (kind == 2.0) {
		float edge = exposed_edge(cell, coordinate, kind);
		float shallows = smoothstep(0.05, 0.69, edge + wash * 0.27);
		paint = mix(vec3(0.40, 0.54, 0.49), vec3(0.26, 0.43, 0.46), shallows);
		paint += wash * 0.075;
		float bend = pigment(ground * vec2(0.46, 0.28));
		float ripple = pow(max(sin(ground.x * 10.0 + bend * 6.0), 0.0), 12.0);
		paint += ripple * smoothstep(0.36, 0.78, pigment(ground * vec2(1.0, 0.37))) * 0.10;
	} else if (kind == 7.0) {
		float edge = exposed_edge(cell, coordinate, kind);
		vec3 shale = vec3(0.47, 0.46, 0.37) + wash * 0.19 + fine * 0.075;
		paint = mix(grass * 0.87, shale, smoothstep(0.0, 0.63, edge + wash * 0.40));
	} else if (kind != 0.0) {
		vec3 earth = vec3(0.55, 0.42, 0.30);
		if (kind == 4.0) { earth = vec3(0.63, 0.58, 0.45); }
		if (kind == 6.0) { earth = vec3(0.46, 0.34, 0.26); }
		paint = earth + wash * 0.12 + fine * 0.035;
	}
	ALBEDO = clamp(paint, vec3(0.0), vec3(1.0));
	ROUGHNESS = 1.0;
}
