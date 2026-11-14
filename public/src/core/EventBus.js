/**
 * Lightweight EventBus for decoupled communication between World, Player, Networking, and UI.
 */

export class EventBus {
    constructor() {
        /** @type {Map<string, Set<Function>>} */
        this.listeners = new Map();
    }

    /**
     * Subscribe to an event.
     * @param {string} event
     * @param {Function} callback
     * @returns {() => void} Unsubscribe helper
     */
    on(event, callback) {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(callback);
        return () => this.off(event, callback);
    }

    /**
     * Unsubscribe from an event.
     * @param {string} event
     * @param {Function} callback
     */
    off(event, callback) {
        const set = this.listeners.get(event);
        if (set) {
            set.delete(callback);
        }
    }

    /**
     * Emit an event payload to all registered listeners.
     * @param {string} event
     * @param {*} payload
     */
    emit(event, payload) {
        const set = this.listeners.get(event);
        if (!set) return;
        for (const fn of set) {
            fn(payload);
        }
    }
}
