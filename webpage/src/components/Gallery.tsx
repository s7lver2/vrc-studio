const screenshots = [
  { src: '/assets/screenshots/01-projects.png', title: 'Projects', alt: 'Projects view' },
  { src: '/assets/screenshots/02-inventory.png', title: 'Inventory', alt: 'Inventory view' },
  { src: '/assets/screenshots/03-packages.png', title: 'Package Manager', alt: 'Packages view' },
  { src: '/assets/screenshots/04-git.png', title: 'Git', alt: 'Git view' },
  { src: '/assets/screenshots/05-settings.png', title: 'Settings', alt: 'Settings view' },
  { src: '/assets/screenshots/06-creators.png', title: 'Creators', alt: 'Creators view' },
]

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

      <div className="gallery-track">
        {screenshots.map((s) => (
          <div key={s.title} className="gallery-item">
            <div className="gallery-item-inner">
              <div className="gallery-item-bar">
                <div className="dot dot-red" />
                <div className="dot dot-yellow" />
                <div className="dot dot-green" />
                <span className="gallery-title">{s.title}</span>
              </div>
              <img src={s.src} alt={s.alt} loading="lazy" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
