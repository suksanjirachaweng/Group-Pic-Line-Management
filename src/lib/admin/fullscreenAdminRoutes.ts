// The tagging canvas and the mobile quick-tag wizard both want the entire viewport — each already
// has its own back link/header, so any shared admin chrome (the top header in AdminChrome.tsx, the
// per-university sub-nav in universities/[id]/layout.tsx) is redundant, space-eating chrome on
// what's effectively a full-screen editor, not a normal padded admin page. Both AdminChrome.tsx and
// UniversitySubNav.tsx import this so they can never disagree on which routes go fullscreen.
const FULLSCREEN_PATTERN =
  /^(\/admin\/universities\/[^/]+\/group-photos\/[^/]+|\/admin\/quick-tag)$/;

export function isFullscreenAdminRoute(pathname: string): boolean {
  return FULLSCREEN_PATTERN.test(pathname);
}
