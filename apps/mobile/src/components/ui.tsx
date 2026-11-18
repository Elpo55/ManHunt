/**
 * Design system mobile. Règles : cibles tactiles >= 44 pt, contrastes élevés,
 * une seule couleur d'accent, couleurs d'équipe réservées à l'information.
 */
import { Feather } from "@expo/vector-icons";
import { parseAvatar } from "@traque/shared";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, radius, space, teamColor } from "../theme";

export type IconName = ComponentProps<typeof Feather>["name"];

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------
type TVariant = "title" | "heading" | "body" | "small" | "caption" | "num" | "numLarge";
const T_STYLES: Record<TVariant, TextStyle> = {
  title: { fontFamily: fonts.semibold, fontSize: 28, lineHeight: 33, color: colors.ivory, letterSpacing: -0.4 },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, color: colors.ivory },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23, color: colors.ivory },
  small: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.fog },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, color: colors.fog },
  num: { fontFamily: fonts.instrument, fontSize: 20, color: colors.ivory, fontVariant: ["tabular-nums"] },
  numLarge: { fontFamily: fonts.instrument, fontSize: 34, color: colors.ivory, fontVariant: ["tabular-nums"], letterSpacing: 1 },
};

export function T({
  v = "body",
  style,
  children,
  numberOfLines,
  color,
}: {
  v?: TVariant;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
  color?: string;
}) {
  return (
    <Text style={[T_STYLES[v], color ? { color } : null, style]} numberOfLines={numberOfLines} maxFontSizeMultiplier={1.4}>
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Écran
// ---------------------------------------------------------------------------
export function Screen({ children, scroll = true, padded = true }: { children: ReactNode; scroll?: boolean; padded?: boolean }) {
  const content = <View style={[padded && { padding: space.lg, gap: space.lg }, !scroll && { flex: 1 }]}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.abyss }} edges={["bottom", "left", "right"]}>
      {scroll ? (
        <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.panel, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={s.rowBetween}>
      <T v="heading">{children}</T>
      {right}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Boutons
// ---------------------------------------------------------------------------
type BVariant = "primary" | "secondary" | "ghost" | "danger" | "hunter";
export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  disabled,
  loading,
  small,
  style,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: BVariant;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const bg = { primary: colors.volt, secondary: colors.slate, ghost: "transparent", danger: "rgba(255,90,78,0.14)", hunter: colors.hunter }[variant];
  const fg = { primary: "#fff", secondary: colors.ivory, ghost: colors.fog, danger: colors.danger, hunter: "#fff" }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        s.button,
        small && { minHeight: 40, paddingHorizontal: space.md },
        { backgroundColor: bg, opacity: off ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Feather name={icon} size={small ? 16 : 18} color={fg} /> : null}
      <Text style={[s.buttonText, { color: fg }, small && { fontSize: 14 }]} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, tint = colors.fog }: { icon: IconName; label: string; onPress: () => void; tint?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [s.iconButton, pressed && { backgroundColor: colors.slate2 }]}
    >
      <Feather name={icon} size={20} color={tint} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Champs
// ---------------------------------------------------------------------------
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <T v="caption" color={colors.ivory}>
        {label}
      </T>
      {children}
      {error ? <T v="small" color={colors.danger}>{error}</T> : hint ? <T v="small">{hint}</T> : null}
    </View>
  );
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.fog2} selectionColor={colors.volt} {...props} style={[s.input, props.style]} />;
}

export function Toggle({ label, description, value, onChange, disabled }: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={[s.rowBetween, { minHeight: 48, opacity: disabled ? 0.5 : 1 }]}>
      <View style={{ flex: 1, paddingRight: space.md }}>
        <T>{label}</T>
        {description ? <T v="small">{description}</T> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.volt, false: colors.slate2 }}
        thumbColor={colors.ivory}
      />
    </View>
  );
}

export function Segmented<V extends string>({ value, options, onChange, disabled }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void; disabled?: boolean }) {
  return (
    <View style={s.segmented} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled }}
            disabled={disabled}
            onPress={() => onChange(o.value)}
            style={[s.segment, on && { backgroundColor: colors.slate2 }]}
          >
            <T v="small" color={on ? colors.ivory : colors.fog} numberOfLines={1}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Réglage numérique tactile (− valeur +), plus fiable qu'un curseur au doigt. */
export function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)));
  return (
    <View style={{ gap: 4 }}>
      <View style={[s.rowBetween, { minHeight: 48 }]}>
        <T style={{ flex: 1 }}>{label}</T>
        <View style={s.row}>
          <IconButton icon="minus" label={`Diminuer ${label}`} onPress={() => !disabled && set(value - step)} />
          <T v="num" style={{ minWidth: 78, textAlign: "center", fontSize: 16 }}>
            {format ? format(value) : String(value)}
          </T>
          <IconButton icon="plus" label={`Augmenter ${label}`} onPress={() => !disabled && set(value + step)} />
        </View>
      </View>
      {hint ? <T v="small">{hint}</T> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Petits éléments
// ---------------------------------------------------------------------------
export function TeamTag({ team }: { team: "hunter" | "fugitive" | null }) {
  const c = teamColor(team);
  return (
    <View style={[s.tag, { backgroundColor: team ? `${c}22` : colors.slate2 }]}>
      {team ? <View style={[s.dot, { backgroundColor: c }]} /> : null}
      <T v="caption" color={team ? c : colors.fog}>
        {team === "hunter" ? "Chasseur" : team === "fugitive" ? "Fugitif" : "Sans équipe"}
      </T>
    </View>
  );
}

export function Avatar({ avatar, name, size = 36 }: { avatar?: string | null; name?: string | null; size?: number }) {
  const { color } = parseAvatar(avatar);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${color}26`, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color, fontFamily: fonts.semibold, fontSize: size * 0.42 }}>{(name ?? "?").slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

export function Notice({ tone = "info", children, icon }: { tone?: "info" | "warn" | "error"; children: ReactNode; icon?: IconName }) {
  const c = { info: colors.volt, warn: colors.warn, error: colors.danger }[tone];
  return (
    <View style={[s.notice, { borderLeftColor: c }]} accessibilityRole={tone === "error" ? "alert" : undefined}>
      {icon ? <Feather name={icon} size={18} color={c} style={{ marginTop: 2 }} /> : null}
      <View style={{ flex: 1 }}>{typeof children === "string" ? <T v="small" color={colors.ivory}>{children}</T> : children}</View>
    </View>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <View style={{ minWidth: "42%", flex: 1 }}>
      <T v="num">{value}</T>
      <T v="small">{label}</T>
      {sub ? <T v="caption" color={colors.fog2}>{sub}</T> : null}
    </View>
  );
}

export function Loading({ label = "Chargement" }: { label?: string }) {
  return (
    <View style={[s.row, { padding: space.xl, gap: space.sm }]}>
      <ActivityIndicator color={colors.fog} />
      <T v="small">{label}</T>
    </View>
  );
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line }} />;
}

// ---------------------------------------------------------------------------
// Notifications (bannières) — annoncées aux lecteurs d'écran
// ---------------------------------------------------------------------------
type Tone = "info" | "success" | "error" | "hunter" | "fugitive";
const ToastCtx = createContext<{ push: (m: string, t?: Tone) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; m: string; t: Tone }[]>([]);
  const seq = useRef(0);
  const insets = useSafeAreaInsets();
  const push = useCallback((m: string, t: Tone = "info") => {
    const id = ++seq.current;
    setItems((cur) => [...cur.slice(-2), { id, m, t }]);
    setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== id)), t === "error" ? 5000 : 3200);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <View pointerEvents="none" style={[s.toastWrap, { top: insets.top + 8 }]}>
        {items.map((x) => (
          <View
            key={x.id}
            accessibilityLiveRegion="polite"
            style={[s.toast, x.t === "hunter" && { borderLeftColor: colors.hunter }, x.t === "fugitive" && { borderLeftColor: colors.fugitive }, x.t === "error" && { borderLeftColor: colors.danger }, x.t === "success" && { borderLeftColor: colors.fugitive }]}
          >
            <T v="small" color={colors.ivory}>
              {x.m}
            </T>
          </View>
        ))}
      </View>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("useToast hors ToastProvider");
  return c;
}

export const s = StyleSheet.create({
  panel: { backgroundColor: colors.graphite, borderRadius: radius.panel, padding: space.lg, gap: space.md },
  row: { flexDirection: "row", alignItems: "center" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  button: { minHeight: 50, borderRadius: radius.control, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, paddingHorizontal: space.lg },
  buttonText: { fontFamily: fonts.semibold, fontSize: 16 },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  input: { minHeight: 50, borderRadius: radius.control, backgroundColor: colors.slate, color: colors.ivory, paddingHorizontal: space.lg, fontFamily: fonts.regular, fontSize: 16 },
  segmented: { flexDirection: "row", backgroundColor: colors.slate, borderRadius: radius.control, padding: 4, gap: 4 },
  segment: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  tag: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  notice: { flexDirection: "row", gap: space.sm, backgroundColor: colors.graphite, borderRadius: radius.control, padding: space.md, borderLeftWidth: 3 },
  toastWrap: { position: "absolute", left: space.lg, right: space.lg, gap: space.sm, zIndex: 100 },
  toast: { backgroundColor: colors.slate2, borderRadius: 12, paddingHorizontal: space.lg, paddingVertical: space.md, borderLeftWidth: 3, borderLeftColor: colors.volt },
});
