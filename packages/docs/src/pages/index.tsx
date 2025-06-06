import React from "react";
import Layout from "@theme/Layout";
import Hero from "@site/src/components/Hero/StartScreen";
import Disclaimer from "@site/src/components/Disclaimer";
import LearnMoreHero from "@site/src/components/LearnMore/LearnMoreHero";
import LearnMoreFooter from "@site/src/components/LearnMore/LearnMoreFooter";
import Installation from "@site/src/components/Sections/Installation";
import LandingBackground from "@site/src/components/Hero/LandingBackground";
import Overview from "@site/src/components/Sections/Overview";
import FAQ from "@site/src/components/Sections/FAQ";

import usePaddle from "@site/src/hooks/usePaddle";
import styles from "./index.module.css";
import Testimonials from "../components/Sections/Testimonials";

export default function Home(): JSX.Element {
  // We need to initialize on the landing coz Paddle redirects here when the user wants to change the card info, there's no way to change it
  usePaddle();

  return (
    <Layout description="Radon IDE is a VSCode extension that turns your editor into an advanced React Native IDE with a robust debugger, network inspector, and more.">
      <LandingBackground />
      <div className={styles.preventfulContainer}>
        <div className={styles.container}>
          <Hero />
          {/* <Disclaimer /> */}
          {/* <LearnMoreHero /> */}
          {/* <Installation /> */}
          <Overview />
          <Testimonials />
          <FAQ />
          <LearnMoreFooter />
        </div>
      </div>
    </Layout>
  );
}
