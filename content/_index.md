---
title: 'Home'
date: 2025-07-01
type: landing

design:
  # Default section spacing
  spacing: "4rem"

# Page flow: promise -> standings -> method -> take part -> landscape -> who we are -> consultation.
sections:
  - block: hero
    content:
      title: Battle of the Analytics Engines
      text: Which analytics engine is fastest? Every benchmark seems to crown its own winner. We turn the public ones we can find into a single ELO leaderboard, so you can see who wins over time.
      primary_action:
        text: See the rankings
        url: /rankings/
      secondary_action:
        text: How it works
        url: "#how-it-works"
    design:
      no_padding: true
      spacing:
        padding: ["5rem", 0, "6rem", 0]
      css_class: "dark"
      background:
        color: "navy"
        image:
          # Images live in `assets/media/`.
          filename: bg-triangles.svg
          filters:
            brightness: 0.5

  # Live top 5 (layouts/_partials/hbx/blocks/elo-top/block.html)
  - block: elo-top
    id: rankingsoverview
    content:
      title: Who is winning right now
      text: |
        Any single benchmark can mislead: whoever runs it picks the queries, the hardware and the rivals. Put many of them together and a clearer picture emerges.

        Each rating sums up **whom an engine has beaten** across TPC-H, TPC-DS, SSB, CH-benCHmark and the Join Order Benchmark. It measures speed in published tests, not price or features.
      button:
        text: Explore the live rankings
        url: rankings/

  - block: features
    id: how-it-works
    content:
      title: How it works
      text: ELO is the rating system used in chess. Here the players are analytics engines, and every public benchmark report is a game.
      items:
        - name: 1. Collect the reports
          icon: magnifying-glass
          description: We gather public performance tests from vendors, users and researchers, even the messy ones. Each links to its source.
        - name: 2. Turn them into matches
          icon: bolt
          description: The finishing order in a report decides who beat whom. Some matches are one-on-one, others compare many engines at once.
        - name: 3. Update the ratings
          icon: arrow-trending-up
          description: Everyone starts at 1500. Beating a stronger engine earns more points, and a report counts half as much for every two years it ages.
    design:
      spacing:
        padding: ["1rem", 0, "1rem", 0]
      css_class: "bg-gray-100 dark:bg-gray-900"

  - block: features
    id: take-part
    content:
      title: Take part
      items:
        - name: Compare by workload
          icon: funnel
          description: Filter by benchmark, follow each engine’s rating history and read the report behind every match on the <a class="underline" href="/rankings/">rankings page</a>.
        - name: Add your benchmark
          icon: plus-circle
          description: Publish your results online and email <a class="underline" href="mailto:atwong@alumni.uci.edu">atwong@alumni.uci.edu</a>. Older reports are welcome too.
        - name: Challenge a result
          icon: chat-bubble-left-right
          description: Disagree with a match, or know a report we missed? Tell us in the <a class="underline" href="/rankings/#discussion">discussion</a>.
    design:
      spacing:
        padding: ["1rem", 0, "1rem", 0]

  - block: cta-image-paragraph
    id: landscape
    content:
      items:
        - title: Beyond the engine, the rest of the lakehouse
          text: The engine is one layer. Our landscape maps open source projects and products to every layer of a data lakehouse, whether you work with a **SQL query engine** or an **analytics processing engine**.
          feature_icon: check
          features:
            - Compute, catalogs and table formats
            - Storage and orchestration
            - Data quality and observability
            - BI and semantic layers
          image: landscape.png
          button:
            text: Explore the landscape
            url: https://data-inconsistencies.github.io/landscape/
    design:
      spacing:
        padding: ["1rem", 0, "1rem", 0]
      css_class: "bg-gray-100 dark:bg-gray-900"

  # Profile cards (layouts/_partials/hbx/blocks/people/block.html)
  - block: people
    id: aboutus
    content:
      title: Who is behind this
      items:
        - name: Albert Wong
          role: Sales Engineer and DevRel leader
          image: profile-albert.jpg
          text: |
            Albert combines deep data and infrastructure experience with a go-to-market mindset, and has worked at VC-backed startups and major technology companies.

            He speaks at meetups and conferences about ELO engine rankings and advises teams on choosing an analytics engine.
          links:
            - text: LinkedIn
              url: https://www.linkedin.com/in/atwong/
        - name: Dr. Georg Heiler
          role: Senior data expert at Magenta, ML-ops engineer at ASCII
          image: profile-georg.jpg
          text: |
            Georg is moving Magenta's data platform to the cloud and works on large-scale, multi-modal ML-ops at ASCII.

            His interests include data architecture, geospatial graphs and time series.
          links:
            - text: LinkedIn
              url: https://www.linkedin.com/in/geoheil/
            - text: Website
              url: https://geoheil.com

  - block: cta-card
    content:
      title: Choosing an engine?
      text: Book a 30-minute consultation. We go beyond the ratings to the strengths and trade-offs of each engine, and you can bring your own unpublished benchmarks to see how they would shift the results.
      button:
        text: Schedule a call
        url: https://calendly.com/geoheil/data-strategy
    design:
      card:
        # text-white here too: the theme's own light body-text class is never generated, so it falls back to dark.
        css_class: "bg-primary-700 text-white"
        css_style: ""
        text_color: light
---
