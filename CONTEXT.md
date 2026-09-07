# WealthX AUM and AUA Dashboard

This context defines the investment data shown by the dashboard and the language used by its projection model.

## Language

**Fund AUM**:
The reported net assets of one mutual-fund class on its NAV date, expressed in million baht.
_Avoid_: WealthX AUA, customer assets

**SeriesX AUM**:
The aggregate Fund AUM of the explicitly configured WealthX SeriesX bucket. MEGA30+TLUSHD and Other Funds are outside this measure.
_Avoid_: all dashboard AUM, total WealthX assets

**Official AUA**:
An actual historical Assets Under Administration figure for WealthX reported by LTMH through SET or LTMH Investor Relations. Company targets and guidance are not Official AUA.
_Avoid_: forecast AUA, target AUA

**Reference Date**:
The date on which an Official AUA figure applies, regardless of when its source document was published.
_Avoid_: announcement date, discovery date

**Announcement Date**:
The date and time at which the source disclosed an Official AUA figure.
_Avoid_: reference date

**Discovery Time**:
The time at which this dashboard first detected a source document or observation.
_Avoid_: announcement date

**Matched Observation**:
An Official AUA observation paired with SeriesX AUM from the same Reference Date or the latest earlier complete AUM date. A later AUM date is never used.

**Model Version**:
An immutable projection calibration identified by the exact Official AUA observations and matched SeriesX AUM inputs used to fit it.

**Anchored AUA Projection**:
An estimate that starts at the latest Official AUA and applies the fitted AUA-to-SeriesX-AUM slope only to the subsequent change in SeriesX AUM.
_Avoid_: official AUA, company guidance

**Pending Observation**:
A detected AUA-like disclosure that cannot yet be accepted as Official AUA because its amount, Reference Date, or source identity is incomplete or conflicting.
