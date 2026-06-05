import { useEffect } from 'react'
import Nav from './components/Nav'
import Hero from './components/Hero'
import FeatureGrid from './components/FeatureGrid'
import InventorySection from './components/InventorySection'
import GitSection from './components/GitSection'
import PrivacySection from './components/PrivacySection'
import Gallery from './components/Gallery'
import Install from './components/Install'
import Credits from './components/Credits'
import Footer from './components/Footer'

export default function App() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('visible')
        })
      },
      { threshold: 0.1, rootMargin: '0px 0px -60px 0px' },
    )
    document.querySelectorAll('.fade-up').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <Nav />
      <Hero />
      <FeatureGrid />
      <div className="section-divider" />
      <InventorySection />
      <div className="section-divider" />
      <GitSection />
      <div className="section-divider" />
      <PrivacySection />
      <Gallery />
      <Install />
      <div className="section-divider" />
      <Credits />
      <Footer />
    </>
  )
}
