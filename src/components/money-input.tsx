import { useState } from "react";
import { Input } from "@/components/ui/input";
import { moneyInputValue, moneyDisplayValue } from "@/lib/pricing";

/**
 * Number input for money (2dp) that can never display a float32 artifact
 * (round 4 defense-in-depth).
 *
 * - While the field is focused, the raw string is shown untouched, so
 *   typing is never rewritten mid-keystroke.
 * - When it is not focused, the displayed value always passes through
 *   moneyInputValue, so even if the parent state somehow holds
 *   21.989999771118164, the input shows "21.99".
 * - On blur, the clean 2dp string is committed back to the parent, so
 *   state is clean too. The save paths already roundMoney on write; this
 *   only guarantees what the field itself shows.
 */
type MoneyInputProps = Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (v: string) => void;
};

export function MoneyInput({ value, onChange, step = 0.01, ...props }: MoneyInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Input
      type="number"
      step={step}
      value={moneyDisplayValue(value, focused)}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const clean = moneyInputValue(value);
        if (clean !== String(value ?? "")) onChange(clean);
      }}
      {...props}
    />
  );
}
