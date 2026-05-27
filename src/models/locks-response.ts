
import { LockList } from './lock-list';

/**
 * Represents the HTTP API model for a response with an array of locks.
 */
export interface LocksResponse {

    /**
     * Gets or sets the requested locks.
     */
    list: Array<LockList>;

    /**
     * Gets or sets the TTLock error code, when present.
     */
    errcode?: number;

    /**
     * Gets or sets the TTLock error message, when present.
     */
    errmsg?: string;

    /**
     * Gets or sets the TTLock error description, when present.
     */
    description?: string;
}
