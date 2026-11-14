/**
 * Axis-Aligned Bounding Box (AABB) utility for player physics and block overlap checks.
 */

export class AABB {
    constructor(minX, minY, minZ, maxX, maxY, maxZ) {
        this.minX = minX;
        this.minY = minY;
        this.minZ = minZ;
        this.maxX = maxX;
        this.maxY = maxY;
        this.maxZ = maxZ;
    }

    static fromPlayerPosition(x, y, z, halfWidth, height) {
        return new AABB(
            x - halfWidth,
            y,
            z - halfWidth,
            x + halfWidth,
            y + height,
            z + halfWidth
        );
    }

    /**
     * Strict overlap check against another AABB (touching faces do not count as intersecting).
     */
    intersects(other, eps = 1e-5) {
        return (
            this.maxX > other.minX + eps &&
            this.minX < other.maxX - eps &&
            this.maxY > other.minY + eps &&
            this.minY < other.maxY - eps &&
            this.maxZ > other.minZ + eps &&
            this.minZ < other.maxZ - eps
        );
    }

    /**
     * Check if this AABB overlaps a unit voxel cube at integer (bx, by, bz).
     */
    intersectsBlock(bx, by, bz, eps = 1e-5) {
        return (
            this.maxX > bx + eps &&
            this.minX < bx + 1 - eps &&
            this.maxY > by + eps &&
            this.minY < by + 1 - eps &&
            this.maxZ > bz + eps &&
            this.minZ < bz + 1 - eps
        );
    }
}
