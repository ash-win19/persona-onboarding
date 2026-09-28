import Header from "@/components/Header";
import Hero from "@/components/Hero";
import PersonaBand from "@/components/PersonaBand";
import Privacy from "@/components/Privacy";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <PersonaBand />
        <Privacy />
      </main>
      <Footer />
    </>
  );
}
