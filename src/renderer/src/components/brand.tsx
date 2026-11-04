import { cx } from '../util'

// Hangar's mark: a hangar's arch with one bead parked inside, the project.
// The bead is the same liquid bead the app moves with: the loader buds it,
// a toast grows out of it, a selection glides like it.

/** The hangar: its floor, then its arch, drawn in a 24-unit box. */
export const ARCH = 'M4.4 18.4H19.6M6.2 18.4V12.2a5.8 5.8 0 0 1 11.6 0v6.2'
/** The bead parked inside, resting on the floor. */
const BEAD = { cx: 12, cy: 15.6, r: 2.3 }

/** The app's mark on its tile (sidebar, launcher). */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg className={cx('logo', className)} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect className="logo-tile" width="24" height="24" rx="7" />
      <path className="logo-arch" d={ARCH} />
      <circle className="logo-bead" {...BEAD} />
    </svg>
  )
}

/**
 * The welcome screen's mark: the arch draws itself, then the bead rolls in
 * through the door and settles with a little squash, like a drop landing.
 */
export function LogoHero({ size = 72 }: { size?: number }) {
  return (
    <svg className="logo-hero" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect className="logo-tile" width="24" height="24" rx="7" />
      <path className="logo-arch" d={ARCH} pathLength={1} />
      <g className="logo-roll">
        <circle className="logo-bead" {...BEAD} />
      </g>
    </svg>
  )
}
