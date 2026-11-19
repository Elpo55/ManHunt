/**
 * QR code dessiné en vues natives (bibliothèque qrcode-generator, 100 %
 * JavaScript) : une vue par segment noir de chaque ligne, pas de module SVG.
 */
import makeQr from "qrcode-generator";
import { memo, useMemo } from "react";
import { View } from "react-native";

export const QrCode = memo(function QrCode({ value, size = 240 }: { value: string; size?: number }) {
  const rows = useMemo(() => {
    const qr = makeQr(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const out: { y: number; runs: [number, number][] }[] = [];
    for (let r = 0; r < n; r++) {
      const runs: [number, number][] = [];
      let start = -1;
      for (let c = 0; c <= n; c++) {
        const dark = c < n && qr.isDark(r, c);
        if (dark && start < 0) start = c;
        if (!dark && start >= 0) {
          runs.push([start, c - start]);
          start = -1;
        }
      }
      out.push({ y: r, runs });
    }
    return { n, out };
  }, [value]);
  const quiet = 4; // marge blanche réglementaire (4 modules)
  const cell = size / (rows.n + quiet * 2);
  return (
    <View
      style={{ width: size, height: size, backgroundColor: "#ffffff", borderRadius: 12 }}
      accessible
      accessibilityLabel="QR code de capture à présenter au Chasseur"
    >
      {rows.out.map((row) =>
        row.runs.map(([x, w]) => (
          <View
            key={`${row.y}:${x}`}
            style={{ position: "absolute", left: (x + quiet) * cell, top: (row.y + quiet) * cell, width: w * cell + 0.5, height: cell + 0.5, backgroundColor: "#000000" }}
          />
        )),
      )}
    </View>
  );
});
