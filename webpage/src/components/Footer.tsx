export default function Footer() {
  return (
    <footer>
      <div className="footer-inner">
        <div className="footer-logo">
          <img src="/assets/logo-mark-512.png" alt="VRC Studio" />
          <span>VRC Studio</span>
        </div>
        <p className="footer-copy">
          Made with <span className="heart">♥</span> for the VRChat creator community
        </p>
        <div className="footer-links">
          <a href="https://github.com/s7lver/vrc-studio" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <a href="https://github.com/s7lver/vrc-studio/releases" target="_blank" rel="noopener noreferrer">
            Releases
          </a>
          <a href="https://github.com/s7lver/vrc-studio/issues" target="_blank" rel="noopener noreferrer">
            Issues
          </a>
        </div>
      </div>
    </footer>
  )
}
