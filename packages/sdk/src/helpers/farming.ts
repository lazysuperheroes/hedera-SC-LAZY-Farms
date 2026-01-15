/**
 * Farming Helper Functions
 * Utilities for mission/farming operations
 */

import { GEM_LEVELS, GEM_LEVEL_NAMES } from '../constants';
import type { MissionStatus } from '../types';

/**
 * Convert gem rank number to level name
 * @param rank - Numeric rank (0-5)
 * @returns Level name (C, R, SR, UR, LR, SPE)
 */
export function lookupLevel(rank: number): string {
  if (rank >= 0 && rank < GEM_LEVEL_NAMES.length) {
    return GEM_LEVEL_NAMES[rank];
  }
  return String(rank);
}

/**
 * Convert gem level name to rank number
 * @param levelName - Level name or numeric string
 * @returns Numeric rank
 */
export function getLevel(levelName: string): number {
  const upper = levelName.toUpperCase();
  const level = GEM_LEVELS[upper as keyof typeof GEM_LEVELS];
  if (level !== undefined) {
    return level;
  }
  const parsed = parseInt(levelName, 10);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Determine mission status from contract data
 * @param startTime - Mission start timestamp
 * @param endTime - Mission end timestamp (0 = no end)
 * @param isPaused - Whether mission is paused
 * @param isClosed - Whether mission is closed
 * @returns Mission status
 */
export function determineMissionStatus(
  startTime: number,
  endTime: number,
  isPaused: boolean,
  isClosed: boolean
): MissionStatus {
  if (isClosed) {
    return 'closed';
  }

  const now = Math.floor(Date.now() / 1000);

  if (startTime > now) {
    return 'pending';
  }

  if (endTime > 0 && endTime < now) {
    return 'completed';
  }

  return 'active';
}

/**
 * Calculate time remaining in a mission for a user
 * @param entryTime - User's entry timestamp
 * @param duration - Mission duration in seconds
 * @returns Remaining seconds (0 if complete, negative if overdue)
 */
export function calculateTimeRemaining(entryTime: number, duration: number): number {
  const completionTime = entryTime + duration;
  const now = Math.floor(Date.now() / 1000);
  return completionTime - now;
}

/**
 * Check if a user can claim mission rewards
 * @param entryTime - User's entry timestamp
 * @param duration - Mission duration in seconds
 * @param boostPercentage - Active boost percentage (0-100)
 * @returns Whether user can claim
 */
export function canClaimRewards(
  entryTime: number,
  duration: number,
  boostPercentage: number = 0
): boolean {
  if (entryTime === 0) {
    return false; // Not in mission
  }

  // Calculate effective duration with boost
  const boostReduction = Math.floor((duration * boostPercentage) / 100);
  const effectiveDuration = duration - boostReduction;

  const completionTime = entryTime + effectiveDuration;
  const now = Math.floor(Date.now() / 1000);

  return now >= completionTime;
}

/**
 * Format duration for display
 * @param seconds - Duration in seconds
 * @returns Human-readable duration string
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

/**
 * Calculate boost cost in $LAZY
 * @param targetPercent - Desired boost percentage
 * @param costPerPercent - $LAZY cost per percentage point
 * @returns Total $LAZY cost
 */
export function calculateBoostCost(
  targetPercent: number,
  costPerPercent: bigint
): bigint {
  return BigInt(targetPercent) * costPerPercent;
}

/**
 * Calculate effective duration with boost
 * @param baseDuration - Original mission duration in seconds
 * @param boostPercent - Boost percentage (0-100)
 * @returns Reduced duration in seconds
 */
export function calculateBoostedDuration(
  baseDuration: number,
  boostPercent: number
): number {
  const reduction = Math.floor((baseDuration * boostPercent) / 100);
  return baseDuration - reduction;
}
