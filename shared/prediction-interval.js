import { randomGamma, randomLcg, randomNormal } from "d3-random";

export const ALGORITHM_VERSION = "anchored-bootstrap-v1";
export const INTERVAL_METHOD = "parametric-anchored-error-bootstrap-10000";
export const BOOTSTRAP_DRAWS = 10000;

export function predictionInterval(model, date, x, center, seed) {
  if (date === model.anchor.referenceDate) return { lower: center, upper: center };
  const random = randomLcg(seed);
  const normal = randomNormal.source(random)(0, 1);
  const chiSquare = randomGamma.source(random)(model.pairCount / 2 - 1, 2);
  const errors = new Float64Array(BOOTSTRAP_DRAWS);
  const dx = x - model.anchor.aumMillionBaht;
  const centeredX = model.pairs.map((p) => p.aumMillionBaht - model.xMean);
  for (let draw = 0; draw < BOOTSTRAP_DRAWS; draw++) {
    const sigma = Math.sqrt(model.sse / chiSquare());
    let slopeNoise = 0;
    let anchorError = 0;
    // Refit OLS on simulated training responses, retaining the anchor's covariance.
    for (let i = 0; i < centeredX.length; i++) {
      const residual = sigma * normal();
      slopeNoise += centeredX[i] * residual;
      if (i === centeredX.length - 1) anchorError = residual;
    }
    const refittedSlope = model.slope + slopeNoise / model.sxx;
    const futureError = sigma * normal();
    errors[draw] = futureError - anchorError + (model.slope - refittedSlope) * dx;
  }
  errors.sort();
  return {
    lower: Math.max(0, Math.min(center, center + quantile(errors, 0.025))),
    upper: Math.max(center, center + quantile(errors, 0.975))
  };
}

function quantile(values, probability) {
  const position = (values.length - 1) * probability;
  const lo = Math.floor(position);
  return values[lo] + (values[Math.ceil(position)] - values[lo]) * (position - lo);
}
