import Link from "next/link";

export const metadata = {
  title: "r31d.wiki",
  description: "Small tools and league miscellany.",
};

export default function Home() {
  return (
    <main className="home-shell">
      <section className="home-card">
        <p className="eyebrow">r31d.wiki</p>
        <h1>Small tools, weird little corners.</h1>
        <p>
          Live league scoring and other fantasy football miscellany.
        </p>
        <Link className="button home-link" href="/fantasy_football/dst">
          Open DST scoring
        </Link>
      </section>
    </main>
  );
}
