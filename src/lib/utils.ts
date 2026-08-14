import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(num: number, decimals = 1): string {
  return Number(num).toFixed(decimals);
}

export function calculateBMR(
  weight: number,
  height: number,
  age: number,
  gender: string
): number {
  // Mifflin-St Jeor Equation
  if (gender === "male") {
    return 10 * weight + 6.25 * height - 5 * age + 5;
  }
  return 10 * weight + 6.25 * height - 5 * age - 161;
}

export function calculateTDEE(bmr: number, activityLevel: string): number {
  const multipliers: Record<string, number> = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9,
  };
  return bmr * (multipliers[activityLevel] || 1.55);
}

export interface WeightPlan {
  direction: "lose" | "gain" | "maintain";
  currentWeight: number;
  targetWeight: number;
  weightDiff: number;
  tdee: number;
  dailyCalorieTarget: number;
  dailyDeficit: number;
  weeklyRateKg: number;
  estimatedWeeks: number;
  estimatedDate: string;
  proteinTarget: number;
}

export function calculateWeightPlan(
  currentWeight: number,
  targetWeight: number,
  tdee: number
): WeightPlan {
  const diff = currentWeight - targetWeight;
  const absDiff = Math.abs(diff);

  let direction: "lose" | "gain" | "maintain";
  if (diff > 0.5) direction = "lose";
  else if (diff < -0.5) direction = "gain";
  else direction = "maintain";

  // Safe rate: 0.5 kg/week = ~500 kcal/day deficit
  // For gaining: 0.25 kg/week = ~250 kcal/day surplus
  let dailyDeficit: number;
  let weeklyRateKg: number;

  if (direction === "lose") {
    // Cap deficit at 500-750 kcal/day for safety, scale down for small diffs
    dailyDeficit = Math.min(500, absDiff * 100);
    weeklyRateKg = (dailyDeficit * 7) / 7700; // 7700 kcal ≈ 1 kg fat
  } else if (direction === "gain") {
    dailyDeficit = -Math.min(350, absDiff * 75); // surplus (negative deficit)
    weeklyRateKg = (Math.abs(dailyDeficit) * 7) / 7700;
  } else {
    dailyDeficit = 0;
    weeklyRateKg = 0;
  }

  const dailyCalorieTarget = Math.round(tdee - dailyDeficit);
  const estimatedWeeks = weeklyRateKg > 0 ? Math.ceil(absDiff / weeklyRateKg) : 0;

  const estimatedDate = new Date();
  estimatedDate.setDate(estimatedDate.getDate() + estimatedWeeks * 7);

  // Protein: 1.6-2g per kg of bodyweight for muscle preservation
  const proteinTarget = Math.round(
    (direction === "lose" ? 2.0 : 1.6) * targetWeight
  );

  return {
    direction,
    currentWeight,
    targetWeight,
    weightDiff: absDiff,
    tdee: Math.round(tdee),
    dailyCalorieTarget,
    dailyDeficit: Math.round(Math.abs(dailyDeficit)),
    weeklyRateKg: Math.round(weeklyRateKg * 100) / 100,
    estimatedWeeks,
    estimatedDate: estimatedDate.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    }),
    proteinTarget,
  };
}
