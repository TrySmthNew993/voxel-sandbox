/**
 * Procedural 10-minute (600s) celestial Day/Night cycle.
 * timeOfDay in [0, 1):
 *   0.00 = midnight
 *   0.25 = sunrise
 *   0.50 = noon
 *   0.75 = sunset
 */
export class DayNightCycle {
    constructor(dayLengthSeconds = 600, initialTime = 0.30) {
        this.dayLengthSeconds = dayLengthSeconds;
        this.timeOfDay = initialTime;
        this.dayCount = 1;

        this.skyColor = { r: 0.47, g: 0.72, b: 0.96 };
        this.fogColor = { r: 0.56, g: 0.78, b: 0.97 };
        this.sunColor = { r: 1.0, g: 0.96, b: 0.88 };
        this.hemiSkyColor = { r: 0.66, g: 0.84, b: 1.0 };
        this.hemiGroundColor = { r: 0.25, g: 0.22, b: 0.18 };
    }

    update(dt) {
        const delta = dt / this.dayLengthSeconds;
        this.timeOfDay += delta;
        if (this.timeOfDay >= 1) {
            this.timeOfDay -= Math.floor(this.timeOfDay);
            this.dayCount++;
        }
    }

    /**
     * Returns sun elevation angle in radians (0 at sunrise, PI/2 at noon, PI at sunset).
     */
    getSunAngle() {
        return (this.timeOfDay - 0.25) * Math.PI * 2;
    }

    /**
     * Returns true during night (when sun is below horizon).
     */
    isNight() {
        return this.timeOfDay < 0.23 || this.timeOfDay > 0.77;
    }

    /**
     * Smooth daylight factor in [0, 1].
     */
    getDaylight() {
        const elevation = Math.sin(this.getSunAngle());
        return Math.max(0, Math.min(1, (elevation + 0.18) / 0.48));
    }

    /**
     * Twilight factor in [0, 1], peaking around sunrise (0.25) and sunset (0.75).
     */
    getTwilight() {
        const elevation = Math.sin(this.getSunAngle());
        return Math.max(0, 1 - Math.abs(elevation) / 0.28);
    }

    /**
     * Updates pre-allocated color structs and returns lighting intensities.
     */
    getLightingState() {
        const daylight = this.getDaylight();
        const twilight = this.getTwilight();

        // Sky color: night -> twilight -> day
        const daySky = [0.47, 0.72, 0.96];
        const nightSky = [0.04, 0.06, 0.13];
        const duskSky = [0.85, 0.44, 0.28];

        this._mix3(this.skyColor, nightSky, daySky, daylight);
        if (twilight > 0.01) {
            this._blendInto(this.skyColor, duskSky, twilight * 0.55);
        }

        const dayFog = [0.56, 0.78, 0.97];
        const nightFog = [0.05, 0.07, 0.15];
        const duskFog = [0.78, 0.46, 0.34];
        this._mix3(this.fogColor, nightFog, dayFog, daylight);
        if (twilight > 0.01) {
            this._blendInto(this.fogColor, duskFog, twilight * 0.45);
        }

        // Sun light color
        const daySun = [1.0, 0.96, 0.88];
        const moonSun = [0.45, 0.58, 0.85];
        const duskSun = [1.0, 0.58, 0.30];
        this._mix3(this.sunColor, moonSun, daySun, daylight);
        if (twilight > 0.01) {
            this._blendInto(this.sunColor, duskSun, twilight * 0.65);
        }

        const dayHemi = [0.66, 0.84, 1.0];
        const nightHemi = [0.14, 0.18, 0.32];
        this._mix3(this.hemiSkyColor, nightHemi, dayHemi, daylight);

        return {
            daylight,
            twilight,
            isNight: this.isNight(),
            sunAngle: this.getSunAngle(),
            hemiIntensity: 0.24 + daylight * 0.52,
            sunIntensity: 0.18 + daylight * 0.86,
            fillIntensity: 0.08 + daylight * 0.18,
            starOpacity: Math.max(0, 1 - daylight * 1.6),
        };
    }

    getPhaseLabel() {
        const t = this.timeOfDay;
        if (t >= 0.21 && t < 0.30) return 'Dawn';
        if (t >= 0.30 && t < 0.70) return 'Day';
        if (t >= 0.70 && t < 0.79) return 'Dusk';
        return 'Night';
    }

    getFormattedClock() {
        // Map 0.25 -> 06:00, 0.50 -> 12:00, 0.75 -> 18:00, 0.00 -> 00:00
        const totalMinutes = Math.floor(this.timeOfDay * 24 * 60);
        const hours = Math.floor(totalMinutes / 60) % 24;
        const mins = totalMinutes % 60;
        const hh = String(hours).padStart(2, '0');
        const mm = String(mins).padStart(2, '0');
        return `Day ${this.dayCount} · ${hh}:${mm}`;
    }

    _mix3(out, a, b, t) {
        out.r = a[0] + (b[0] - a[0]) * t;
        out.g = a[1] + (b[1] - a[1]) * t;
        out.b = a[2] + (b[2] - a[2]) * t;
    }

    _blendInto(out, target, t) {
        out.r = out.r + (target[0] - out.r) * t;
        out.g = out.g + (target[1] - out.g) * t;
        out.b = out.b + (target[2] - out.b) * t;
    }
}
