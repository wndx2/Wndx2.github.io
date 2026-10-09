// A spring described the way Apple describes them: `response` is roughly how long it
// takes to get there (seconds), `damping` is the damping ratio (1 = no overshoot).
// It keeps its velocity when the target changes, so it can be redirected mid-flight.
export class Spring {
  velocity = 0;
  target: number;

  constructor(public value: number) {
    this.target = value;
  }

  step(dtSeconds: number, response = 0.35, damping = 1): void {
    const omega = (2 * Math.PI) / response;
    const stiffness = omega * omega;
    const friction = 2 * damping * omega;
    // Fixed 1ms sub-steps keep the integration stable at any frame rate.
    let remaining = dtSeconds;
    while (remaining > 0) {
      const h = Math.min(remaining, 0.001);
      const acceleration = -stiffness * (this.value - this.target) - friction * this.velocity;
      this.velocity += acceleration * h;
      this.value += this.velocity * h;
      remaining -= h;
    }
  }

  settled(epsilon: number): boolean {
    return Math.abs(this.value - this.target) < epsilon && Math.abs(this.velocity) < epsilon * 10;
  }

  finish(): void {
    this.value = this.target;
    this.velocity = 0;
  }
}

// How far a flick travels before friction stops it, and its decay per millisecond.
// Same exponential model as scroll deceleration; 0.998 is the standard scroll feel,
// a little lower stops sooner, which suits a graph you want to land precisely.
export const DECELERATION = 0.996;

// Advances a decaying velocity (px/s) by dt milliseconds; returns the distance covered.
export function decay(velocity: number, dtMs: number): { distance: number; velocity: number } {
  const factor = Math.pow(DECELERATION, dtMs);
  return {
    distance: ((velocity / 1000) * (factor - 1)) / Math.log(DECELERATION),
    velocity: velocity * factor,
  };
}
