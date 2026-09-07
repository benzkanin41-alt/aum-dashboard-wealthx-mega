# AUA Projection and Validation

## Formula

`Projected AUA(t) = Latest official AUA(s) + b * [SeriesX AUM(t) - SeriesX AUM(s)]`

- `s` is the reference date of the latest verified official AUA.
- `b` is the ordinary-least-squares slope fitted on level pairs of verified
  AUA and strict SeriesX AUM.
- AUA is paired with SeriesX AUM from the same date or the nearest earlier
  complete aggregate. A future AUM point is never used.
- The dashboard separately reports Pearson correlation, R-squared, slope,
  pair count, and model version.
- A model requires at least four valid pairs and non-zero AUM variance.
- Four to seven pairs are labelled provisional. Correlation is diagnostic and
  is never presented as a guarantee.
- Projection ends on the latest available AUM date.

## Versioning

- New or corrected official AUA changes the training fingerprint and creates a
  new immutable model version.
- A revision to any historical AUM point used in training also creates a new
  model version.
- New AUM after the anchor changes projection but reuses the model version.
- Repeated documents with identical observations do not create a model version.
- Recorded historical projections are immutable and distinct from later
  reconstructed backtests.

## Automated Test Matrix

1. Reproduce every audited AUA/AUM matched pair.
2. Verify the anchored formula independently from the model helper.
3. Add a new AUM point: projection changes and model fingerprint does not.
4. Add or correct AUA: model fingerprint changes.
5. Refuse fewer than four pairs and zero-variance AUM.
6. Confirm a future AUM point is never matched.
7. Parse Settrade Nuxt data without evaluating remote JavaScript.
8. Accept explicit actual AUA wording and reject target wording.

Runtime acceptance additionally checks source availability, duplicate refresh
reuse, five-minute rate limiting, D1 foreign keys, matching Local/Sites data
versions, and desktop/iPhone/iPad rendering in both themes.
