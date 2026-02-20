'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/providers/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Loader2, Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const { signIn, signInWithGoogle } = useAuth()
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Client-side validation
    if (!email.trim()) {
      toast.error('Please enter your email address to sign in.')
      return
    }
    
    if (!email.includes('@')) {
      toast.error('Please enter a valid email address.')
      return
    }
    
    if (!password.trim()) {
      toast.error('Please enter your password to sign in.')
      return
    }
    
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters long.')
      return
    }
    
    setLoading(true)

    try {
      const { error } = await signIn(email, password)
      if (!error) {
        toast.success('Successfully signed in! Redirecting to dashboard...')
        router.push('/')
        router.refresh()
      }
    } catch (error: any) {
      console.error('Sign in error:', error)
      toast.error('An unexpected error occurred during sign in. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setLoading(true)
    try {
      await signInWithGoogle()
      // The user will be redirected to Google for authentication
      // After successful auth, they'll be redirected back to /auth/callback
    } catch (error: any) {
      console.error('Google sign in error:', error)
      let errorMessage = 'Failed to sign in with Google. Please try again.'
      if (error?.message) {
        if (error.message.includes('popup')) {
          errorMessage = 'Google sign in popup was blocked or closed. Please allow popups and try again.'
        } else if (error.message.includes('network')) {
          errorMessage = 'Network error during Google sign in. Please check your connection and try again.'
        } else if (error.message.includes('unauthorized')) {
          errorMessage = 'Google sign in failed: Account not authorized. Please use your company email or request access.'
        }
      }
      toast.error(errorMessage, { duration: 6000 })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Navigation Bar */}
      <nav className="w-full bg-background border-b border-border/50">
        <div className="max-w-full mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            {/* Left Side - Logo and Links */}
            <div className="flex items-center gap-8">
              <Link href="/auth" className="flex items-center">
                <Image
                  src="/M.svg"
                  alt="mithran"
                  width={100}
                  height={38}
                  className="h-6 w-auto"
                  priority
                />
              </Link>
              <a href="#about" className="text-sm font-medium text-foreground/80 hover:text-foreground transition-colors pb-1">
                About
              </a>
              <a href="#faqs" className="text-sm font-medium text-foreground/80 hover:text-foreground transition-colors pb-1">
                FAQ
              </a>
            </div>

            {/* Right Side - Navigation Links */}
            <div className="flex items-center gap-4">
              <Link href="/auth" className="text-sm font-medium text-foreground border-b-2 border-primary pb-1">
                Sign In
              </Link>
              <Link href="/demo">
                <Button variant="outline" className="h-9 px-5 rounded-none border-foreground/80 text-sm text-foreground hover:bg-transparent hover:text-primary hover:border-primary">
                  Request Demo
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Top Section - Auth Form */}
      <div className="flex relative flex-1">
        {/* Left Side - Branding */}
        <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-card to-secondary p-12 flex-col relative overflow-hidden"
          style={{
            clipPath: 'polygon(0 0, 100% 0, 85% 100%, 0 100%)'
          }}>

          <div className="relative z-10 text-center flex-1 flex flex-col justify-center items-center -ml-8 pt-8">
            <Image
              src="/favicon.svg"
              alt="mithran"
              width={90}
              height={90}
              className="mb-8"
              priority
            />
            <h2 className="text-3xl font-semibold text-foreground mb-4">Welcome back!</h2>
            <p className="text-muted-foreground text-base max-w-xs">
              One-stop solution provider to all manufacturing segments
            </p>
          </div>

          {/* Illustration at bottom */}
          <div className="flex justify-center items-end relative z-10 pb-8">
            <div className="relative w-full max-w-lg">
              <Image
                src="/hero.svg"
                alt="Manufacturing illustration"
                width={500}
                height={400}
                className="w-full h-auto"
                priority
              />
            </div>
          </div>
        </div>

        {/* Right Side - Login Form */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-8 lg:p-16 bg-background relative">
          <div className="w-full max-w-md space-y-8">
            <div>
              <h2 className="text-3xl font-bold text-foreground mb-2">Sign in your account</h2>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-semibold text-foreground">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Type Your Email Address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  className="h-14 bg-secondary/50 border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/50 focus-visible:border-primary rounded-xl"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-semibold text-foreground">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Type Your Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    disabled={loading}
                    className="h-14 bg-secondary/50 border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/50 focus-visible:border-primary rounded-xl pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-14 bg-card hover:bg-card/80 text-foreground font-semibold rounded-2xl transition-all duration-200 border border-border/50"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  'Sign In'
                )}
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">Or</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={handleGoogleSignIn}
                className="w-full h-14 border-border bg-secondary/30 hover:bg-secondary/50 hover:text-foreground hover:border-primary/50 rounded-2xl font-semibold transition-all duration-200"
                disabled={loading}
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Sign in with Google
              </Button>
            </form>

            <div className="text-center pt-4">
              <p className="text-sm text-muted-foreground">
                Don't have an account?{' '}
                <Link href="/demo" className="text-primary hover:underline font-medium">
                  Request a demo
                </Link>
              </p>
            </div>

            {/* Progress indicator dots at bottom */}
            <div className="flex justify-center gap-2 pt-4">
              <Link href="/demo">
                <div className="w-8 h-1 bg-muted-foreground/30 rounded-full cursor-pointer hover:bg-muted-foreground/50 transition-colors" />
              </Link>
              <Link href="/auth">
                <div className="w-8 h-1 bg-muted-foreground rounded-full cursor-pointer hover:bg-primary transition-colors" />
              </Link>
            </div>

            {/* Footer Links */}
            <div className="flex justify-center gap-6 pt-8 text-sm">
              <a href="#about" className="text-muted-foreground hover:text-primary transition-colors">
                About Us
              </a>
              <span className="text-muted-foreground/30">•</span>
              <a href="#faqs" className="text-muted-foreground hover:text-primary transition-colors">
                FAQs
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* About Us & FAQs Section */}
      <div id="about" className="w-full bg-background border-t border-border">
        <div className="container max-w-3xl mx-auto px-8 py-16 space-y-12">

          {/* About mithran */}
          <div>
            <h2 className="text-3xl font-bold text-foreground mb-6">About mithran</h2>
            <p className="text-muted-foreground mb-4 leading-relaxed">
              mithran is dedicated to revolutionizing the manufacturing industry by providing
              comprehensive solutions that streamline operations, optimize costs, and enhance
              productivity across all manufacturing segments.
            </p>
            <p className="text-muted-foreground mb-0 leading-relaxed">
              We specialize in manufacturing cost modeling, process optimization, and end-to-end
              solutions that help engineering teams make informed decisions.
            </p>
          </div>

          {/* Why Choose Us */}
          <div>
            <h3 className="text-2xl font-semibold text-foreground mb-6">Why Choose Us</h3>
            <ul className="space-y-4 text-muted-foreground">
              <li className="flex items-start gap-3">
                <span className="text-primary mt-0.5"></span>
                <span>Comprehensive manufacturing cost analysis</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-0.5"></span>
                <span>Real-time data insights and analytics</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-0.5"></span>
                <span>Seamless integration with existing systems</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-0.5"></span>
                <span>Expert support and consultation</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary mt-0.5"></span>
                <span>Scalable solutions for all business sizes</span>
              </li>
            </ul>
          </div>

          {/* FAQs */}
          <div id="faqs">
            <h2 className="text-3xl font-bold text-foreground mb-8">Frequently Asked Questions</h2>
            <div className="space-y-4">
              <details className="group bg-card border border-border rounded-lg">
                <summary className="cursor-pointer p-4 font-semibold text-foreground hover:text-primary transition-colors list-none flex items-center justify-between">
                  What is mithran?
                  <span className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="px-4 pb-4 text-muted-foreground">
                  mithran is a comprehensive manufacturing solution platform that provides cost modeling,
                  process optimization, and data analytics tools for engineering teams across all
                  manufacturing segments.
                </div>
              </details>

              <details className="group bg-card border border-border rounded-lg">
                <summary className="cursor-pointer p-4 font-semibold text-foreground hover:text-primary transition-colors list-none flex items-center justify-between">
                  How do I get started?
                  <span className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="px-4 pb-4 text-muted-foreground">
                  You can get started by requesting a demo. Our team will reach out to schedule a
                  personalized demonstration. If you already have an account, simply sign in above.
                </div>
              </details>

              <details className="group bg-card border border-border rounded-lg">
                <summary className="cursor-pointer p-4 font-semibold text-foreground hover:text-primary transition-colors list-none flex items-center justify-between">
                  What features does mithran offer?
                  <span className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="px-4 pb-4 text-muted-foreground">
                  mithran offers manufacturing cost modeling, real-time analytics, vendor management,
                  raw materials database, equipment tracking, BOM management, and collaborative tools.
                </div>
              </details>

              <details className="group bg-card border border-border rounded-lg">
                <summary className="cursor-pointer p-4 font-semibold text-foreground hover:text-primary transition-colors list-none flex items-center justify-between">
                  Is my data secure?
                  <span className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="px-4 pb-4 text-muted-foreground">
                  Yes, data security is our top priority. We implement industry-standard encryption,
                  secure authentication, and regular security audits to protect your data.
                </div>
              </details>

              <details className="group bg-card border border-border rounded-lg">
                <summary className="cursor-pointer p-4 font-semibold text-foreground hover:text-primary transition-colors list-none flex items-center justify-between">
                  Can mithran integrate with existing systems?
                  <span className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="px-4 pb-4 text-muted-foreground">
                  Yes, mithran integrates with existing ERP, PLM, and other manufacturing systems
                  through APIs and custom integrations. Contact us to discuss your requirements.
                </div>
              </details>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="w-full bg-card border-t border-border">
        <div className="max-w-full px-6 py-12">
          <div className="mb-8">
            <Image
              src="/M.svg"
              alt="mithran"
              width={140}
              height={52}
              className="h-10 w-auto mb-6"
            />
            <p className="text-muted-foreground text-sm max-w-2xl leading-relaxed">
              This Manufacturing Cost Calculator is provided for general informational purposes only and does not constitute any legal, tax or business advice. Verify all calculations with your accounting and engineering teams as cost estimates are subject to change without notice. We do not accept any liability as a result of using this tool.
            </p>
          </div>

          {/* Bottom Bar */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pt-6">
            <div className="flex gap-4">
              <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
              </a>
              <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              </a>
            </div>

            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
              <span>© {new Date().getFullYear()} mithran. All rights reserved.</span>
              <span>/</span>
              <a href="#" className="hover:text-primary transition-colors">Terms of Use</a>
              <span>/</span>
              <a href="#" className="hover:text-primary transition-colors">Privacy Policy</a>
              <span>/</span>
              <a href="#faqs" className="hover:text-primary transition-colors">FAQ</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}