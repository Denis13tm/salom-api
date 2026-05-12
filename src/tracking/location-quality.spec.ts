import { isPingQualityOk, isPlausibleStep } from "./location-quality";

describe("location-quality", () => {
  it("rejects very poor accuracy (past default max)", () => {
    const r = isPingQualityOk({ lat: 41, lng: 69, accuracyM: 600 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.code).toBe("accuracy");
  });

  it("accepts typical urban GPS (previously blocked at 100 m cap)", () => {
    const r = isPingQualityOk({ lat: 41, lng: 69, accuracyM: 200 });
    expect(r.ok).toBe(true);
  });

  it("accepts fresh ping without client timestamp (server uses now in caller)", () => {
    const r = isPingQualityOk({ lat: 41, lng: 69, accuracyM: 20 });
    expect(r.ok).toBe(true);
  });

  it("rejects implausible high speed in step when dt small", () => {
    const t0 = Date.now();
    const t1 = t0 + 1000;
    const ok = isPlausibleStep(
      { lat: 41, lng: 69, t: t0 },
      { lat: 50, lng: 80, t: t1 },
    );
    expect(ok).toBe(false);
  });
});
