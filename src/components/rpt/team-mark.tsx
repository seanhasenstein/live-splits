import { LOGO } from "@/components/rpt/rpt";
import { logoKey, logoUrl, teamHue, teamInitials } from "@/lib/logos";

/**
 * A team's mark beside its name: our shield for us, the team's logo when one's been added (Season →
 * Team logos), otherwise its initials on a steady color. `size` in px.
 */
export function TeamMark({ name, ours = false, schoolId, logos, size = 18, className = "" }: { name: string; ours?: boolean; schoolId: string; logos: Map<string, number>; size?: number; className?: string }) {
  const style = { width: size, height: size };
  if (ours)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={LOGO} alt="" className={`tmark ${className}`} style={style} />;
  const key = logoKey(name);
  const v = logos.get(key);
  if (v !== undefined)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl(schoolId, key, v)} alt="" className={`tmark ${className}`} style={style} loading="lazy" />;
  const hue = teamHue(name);
  return (
    <span className={`tmark tinit ${className}`} style={{ ...style, fontSize: Math.round(size * 0.42), background: `hsl(${hue} 45% 92%)`, color: `hsl(${hue} 55% 28%)` }} aria-hidden>
      {teamInitials(name)}
    </span>
  );
}
