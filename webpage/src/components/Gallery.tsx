const screenshots = [
  { src: '/assets/screenshots/00-loading.png',   title: 'Loading Screen',  alt: 'Loading screen carousel' },
  { src: '/assets/screenshots/01-projects.png',  title: 'Projects',        alt: 'Project manager' },
  { src: '/assets/screenshots/02-inventory.png', title: 'Asset Inventory', alt: 'Asset inventory' },
  { src: '/assets/screenshots/shop.png',         title: 'Booth Shop',      alt: 'Booth shop', fallback: '/assets/screenshots/03-packages.png' },
  { src: '/assets/screenshots/04-git.png',       title: 'Version Control', alt: 'Git integration' },
  { src: '/assets/screenshots/05-settings.png',  title: 'Settings',        alt: 'Settings panel' },
  { src: '/assets/screenshots/06-creators.png',  title: 'Creators',        alt: 'Creators hub' },
]

function SlideItem({ s }: { s: typeof screenshots[0] }) {
  return (
    <div className="gallery-item" aria-label={s.alt}>
      <div className="gallery-item-inner">
        <div className="gallery-item-bar">
          <div className="dot dot-red" />
          <div className="dot dot-yellow" />
          <div className="dot dot-green" />
          <span className="gallery-title">{s.title}</span>
        </div>
        <img
          src={s.src}
          alt={s.alt}
          loading="lazy"
          onError={(e) => {
            const el = e.target as HTMLImageElement
            if ('fallback' in s && s.fallback && el.src !== window.location.origin + s.fallback) {
              el.src = (s as any).fallback
            }
          }}
        />
      </div>
    </div>
  )
}

export default function Gallery() {
  return (
    <div className="gallery-section" id="gallery">
      <div className="gallery-header fade-up">
        <span className="section-tag">Gallery</span>
        <h2 className="section-title">See it in action.</h2>
        <p className="section-sub" style={{ marginTop: 16 }}>
          Real screenshots from VRC Studio — built for creators, by creators.
        </p>
      </div>

      {/* Infinite marquee — items duplicated so the CSS loop is seamless */}
      <div className="gallery-marquee-wrapper">
        <div className="gallery-marquee-track">
          {screenshots.map((s) => <SlideItem key={s.title} s={s} />)}
          {screenshots.map((s) => <SlideItem key={s.title + '-b'} s={s} />)}
        </div>
      </div>
    </div>
  )
}
