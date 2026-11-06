import { Badge } from "@/components/ui/badge";
import { completenessLabel, type CompletenessParts } from "@/lib/completeness";

/**
 * Listing completeness badge (sales feature #7): 0-100 from title length,
 * item-specifics count, image count and description length. Green when
 * complete (>=80), amber when it needs work (>=50), red below that.
 * The tooltip names the weak parts.
 */
export function CompletenessBadge({ score, parts }: { score: number; parts?: CompletenessParts }) {
  const variant = score >= 80 ? "default" : score >= 50 ? "secondary" : "destructive";
  const title = parts
    ? `${completenessLabel(score)} — title ${parts.title}/25, specifics ${parts.specifics}/25, images ${parts.images}/25, description ${parts.description}/25`
    : `${completenessLabel(score)} — completeness ${score}/100`;
  return (
    <Badge variant={variant} title={title} className="tabular-nums">
      {score}/100
    </Badge>
  );
}
