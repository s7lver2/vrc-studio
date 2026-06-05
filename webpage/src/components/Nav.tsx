export default function Nav() {
  return (
    <nav>
      <a href="#" className="nav-logo">
        <img src="/assets/logo-mark-512.png" alt="VRC Studio" />
        <span>VRC Studio</span>
      </a>
      <div className="nav-links">
        <a href="#features">Features</a>
        <a href="#gallery">Gallery</a>
        <a href="#install">Install</a>
        <a href="#credits">Credits</a>
      </div>
      <a href="https://github.com/s7lver/vrc-studio/releases" className="nav-cta">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Download
      </a>
    </nav>
  )
}
