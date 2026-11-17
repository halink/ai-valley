shader_type spatial;
render_mode diffuse_burley, specular_disabled, cull_disabled;

uniform sampler2D tile_map : filter_nearest, repeat_disable;
uniform sampler2D meadow : source_color, filter_linear_mipmap, repeat_disable;
uniform sampler2D terrain_wash : filter_linear, repeat_disable;
uniform vec2 map_size = vec2(32.0, 24.0);
uniform bool hamlet = false;
uniform bool long_valley = false;
uniform vec4 garden_bounds = vec4(0.0);
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

vec3 hamlet_paint(vec3 grass, float wash, float fine) {
	vec2 eddies = vec2(pigment(ground * .84), pigment(ground.yx * .63)) - .5;
	vec4 stain = texture(terrain_wash, (ground + eddies * (long_valley ? .52 : .34)) / map_size);
	vec3 silt = vec3(.58, .55, .41) + wash * .11 + fine * .04;
	vec3 pigment_base = mix(grass, silt, smoothstep(.22, .70, stain.a));
	vec3 dust = vec3(.64, .52, .37) + wash * .11 + fine * .042;
	vec2 stones = ground * vec2(1.20, 1.8);
	stones.x += step(.5, fract(stones.y * .5)) * .52;
	vec2 seam = min(fract(stones), 1.0 - fract(stones));
	float worn = smoothstep(.01, .11, min(seam.x, seam.y) + wash * .07);
	vec3 flags = mix(vec3(.43, .39, .31), vec3(.67, .63, .51) + wash * .16, worn);
	float trail = smoothstep(.29, .72, stain.r);
	if (long_valley) {
		float bristle = pigment(ground * vec2(3.7, 2.4)) - .5;
		trail = smoothstep(.25, .86, stain.r + bristle * .16);
		dust = mix(pigment_base, vec3(.62, .52, .36) + wash * .17 + fine * .065, .87);
	}
	pigment_base = mix(pigment_base, mix(dust, flags, smoothstep(.38, .74, stain.g)), trail);
	float wash_band = pigment(ground * vec2(.56, .20));
	float ripple = pow(max(sin(ground.x * 8.0 + ground.y * .69 + wash_band * 3.8), 0.0), 18.0);
	vec3 stream = mix(vec3(.43, .60, .51), vec3(.16, .39, .45), smoothstep(.38, 1.0, stain.b));
	stream += (wash_band - .5) * .14 + ripple * smoothstep(.44, .75, wash_band) * .10;
	if (long_valley) {
		float flow = pigment(ground * vec2(.83, .14));
		float broken = pigment(ground * vec2(1.4, .49));
		float strokes = pow(max(sin(ground.x * 9.6 + flow * 7.1), 0.0), 9.0);
		stream = mix(vec3(.51, .62, .50), vec3(.24, .40, .40), smoothstep(.34, .98, stain.b));
		stream += (flow - .5) * .16 + strokes * smoothstep(.44, .76, broken) * .11;
	}
	return mix(pigment_base, stream, smoothstep(.33, .68, stain.b));
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
	if (hamlet) {
		float swale = pigment(ground * vec2(0.19, 0.26));
		vec3 moss = vec3(0.31, 0.43, 0.28);
		vec3 rye = vec3(0.56, 0.59, 0.37);
		grass = mix(grass, mix(moss, rye, swale), 0.62) + 0.055 * wash + 0.05 * fine;
	}
	if (long_valley) {
		vec2 place = ground / map_size;
		float shade = 1.0 - smoothstep(.05, .44, place.y + pigment(ground * .14) * .13);
		float hillside = pigment(ground * vec2(.17, .24));
		float meadow_light = smoothstep(.27, .70, hillside + place.y * .22);
		vec3 herb = mix(vec3(.30, .42, .29), vec3(.61, .59, .38), meadow_light);
		herb = mix(herb, vec3(.31, .44, .37), shade * .66);
		grass = mix(grass, herb, .61) + wash * .064 + fine * .047;
		if (garden_bounds.z > garden_bounds.x && garden_bounds.w > garden_bounds.y) {
			vec2 middle = (garden_bounds.xy + garden_bounds.zw) * .5;
			vec2 size = (garden_bounds.zw - garden_bounds.xy) * .5 + vec2(1.38, 1.36);
			vec2 rim = abs(ground - middle) / size;
			float margin = 1.0 - smoothstep(.82, 1.14, max(rim.x, rim.y) + wash * .14);
			vec3 turf_clay = vec3(.58, .54, .38) + wash * .10 + fine * .055;
			grass = mix(grass, turf_clay, margin * .48);
		}
	}
	vec3 paint = grass;
	if (hamlet && kind != 3.0 && kind != 7.0 && (kind != 6.0 || long_valley)) {
		paint = hamlet_paint(grass, wash, fine);
	} else if (kind == 1.0 || kind == 5.0) {
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
