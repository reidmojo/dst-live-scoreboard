import Link from "next/link";

export const metadata = {
  title: "Fantasy Football | r31d.wiki",
  description: "Fantasy football tools and league miscellany.",
};

export default function FantasyFootballIndex() {
  return (
    <main className="home-shell">
      <section className="home-card">
        <p className="eyebrow">Fantasy football</p>
        <h1>League tools live here.</h1>
        <p>
          Follow live matchups and custom DST drive scoring throughout the season.
        </p>
        <div className="home-links">
          <Link className="button home-link" href="/fantasy_football/dst">
            Open DST scoring
          </Link>
        </div>
      </section>
    </main>
  );
}
