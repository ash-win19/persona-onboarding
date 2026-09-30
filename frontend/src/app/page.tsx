import Link from "next/link";
import { PersonaLogo, PersonaMark } from "./persona-logo";
import { EntryLink } from "./entry-link";
import { ChatIcon } from "./chat-icons";

export default function Home() {
  return (
    <div className="landing">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="public-header">
        <Link href="/" className="wordmark" aria-label="Persona home">
          <PersonaLogo />
        </Link>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#made-for-you">Made for you</a>
          <a href="https://yourpersona.com/band">Persona Band ↗</a>
        </nav>
        <EntryLink />
      </header>
      <main id="main">
        <section className="landing-hero">
          <p className="eyebrow">YOUR LIFE. YOUR PERSONA.</p>
          <h1>
            A little less to do.
            <br />
            <span>A little more you.</span>
          </h1>
          <p className="hero-description">
            Meet the personal assistant that starts with you.
            <br className="desktop-break" /> One conversation. A name, a plan, a
            place to begin.
          </p>
          <div className="hero-actions">
            <EntryLink hero />
            <a className="text-link" href="#how-it-works">
              Take a closer look <span aria-hidden="true">↓</span>
            </a>
          </div>
          <div
            className="persona-preview"
            aria-label="Example of a Persona conversation"
          >
            <div className="preview-orbit">
              <div className="preview-orb">
                <PersonaMark />
              </div>
            </div>
            <div className="preview-caption">
              <span className="status-dot" /> A conversation, made yours.
            </div>
            <div className="sample-message sample-user">
              Help me prepare for my interview.
            </div>
            <div className="sample-message sample-assistant">
              <PersonaMark />
              <span>
                Let&apos;s start with your introduction.
                <br />
                <small>We&apos;ll work through it together.</small>
              </span>
            </div>
            <span className="example-label">Example conversation</span>
          </div>
        </section>
        <section className="landing-section how-it-works" id="how-it-works">
          <div className="section-intro">
            <p className="eyebrow">A SIMPLE START</p>
            <h2>
              Make yourself
              <br />
              at home.
            </h2>
            <p>
              No forms to work through. Just a conversation about you and what
              you need.
            </p>
          </div>
          <div className="steps">
            {[
              [
                "01",
                "Say hello.",
                "Give your Persona a name and tell it a little about yourself.",
              ],
              [
                "02",
                "Find your starting point.",
                "Bring one thing you need help with. Type it out, or talk it through on a call.",
              ],
              [
                "03",
                "Keep the conversation going.",
                "Your dashboard keeps your priorities, daily chats, integrations, and details together.",
              ],
            ].map(([number, title, copy]) => (
              <div className="step" key={number}>
                <span>{number}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="landing-section" id="made-for-you">
          <div className="section-heading">
            <p className="eyebrow">AT YOUR PACE</p>
            <h2>
              Room to think.
              <br />
              Someone to talk to.
            </h2>
          </div>
          <div className="feature-grid">
            <article className="feature-card">
              <ChatIcon name="message" />
              <h3>Start with what matters.</h3>
              <p>
                A tricky decision, an interview, a first draft. Bring the thing
                on your mind.
              </p>
              <div className="feature-detail">One task is a good start.</div>
            </article>
            <article className="feature-card">
              <ChatIcon name="headphones" />
              <h3>Say it your way.</h3>
              <p>
                Switch between text and a browser call. Your Persona keeps up
                with the conversation.
              </p>
              <div className="feature-detail">Your voice. Your pace.</div>
            </article>
            <article className="feature-card">
              <ChatIcon name="check" />
              <h3>Pick up where you left off.</h3>
              <p>
                Your conversation and the details you share are there when you
                come back.
              </p>
              <div className="feature-detail">
                A familiar place to return to.
              </div>
            </article>
          </div>
        </section>
        <section className="landing-cta">
          <PersonaMark />
          <h2>
            Your Persona
            <br />
            starts with you.
          </h2>
          <EntryLink hero />
          <a href="https://yourpersona.com/band" className="text-link">
            Meet Persona Band ↗
          </a>
        </section>
      </main>
      <footer className="public-footer">
        <Link className="wordmark" href="/" aria-label="Persona home">
          <PersonaLogo />
        </Link>
        <p>Your own place to begin.</p>
        <nav aria-label="Footer">
          <a href="https://yourpersona.com/legal/privacy">Privacy</a>
          <a href="https://yourpersona.com/legal">Terms</a>
          <a href="https://yourpersona.com/band">Persona Band ↗</a>
        </nav>
      </footer>
    </div>
  );
}
