# SEO + GEO (Generative Engine Optimization)

## Part 1: Traditional SEO

### Meta Tags Template

Every page should have these meta tags properly configured:

```html
<head>
  <!-- Primary Meta Tags -->
  <title>[Primary Keyword] — [Brand] | [Secondary Keyword or Benefit]</title>
  <meta name="description" content="[150-160 char description with primary keyword
    in first 60 chars. Include a value proposition and CTA.]">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://example.com/page-url">

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://example.com/page-url">
  <meta property="og:title" content="[Compelling title — can differ from <title>]">
  <meta property="og:description" content="[Description optimized for social sharing]">
  <meta property="og:image" content="https://example.com/images/og-image-1200x630.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="[Brand Name]">

  <!-- Twitter Cards -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content="https://example.com/page-url">
  <meta name="twitter:title" content="[Title for Twitter — under 70 chars]">
  <meta name="twitter:description" content="[Description for Twitter — under 200 chars]">
  <meta name="twitter:image" content="https://example.com/images/twitter-card-1200x628.jpg">
  <meta name="twitter:site" content="@yourbrand">
  <meta name="twitter:creator" content="@authorhandle">

  <!-- Additional SEO Tags -->
  <meta name="author" content="[Author Name]">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="content-language" content="en">
  <link rel="alternate" hreflang="en" href="https://example.com/page-url">
  <link rel="alternate" hreflang="es" href="https://example.com/es/page-url">
</head>
```

**Title tag rules:**
- 50-60 characters maximum (Google truncates beyond this)
- Primary keyword in the first 30 characters
- Brand name at the end, separated by a pipe or dash
- Every page must have a unique title

**Meta description rules:**
- 150-160 characters maximum
- Include primary keyword naturally
- Include a value proposition or differentiator
- End with a CTA when appropriate
- Every page must have a unique description

### JSON-LD Structured Data

Structured data helps search engines understand your content and enables rich snippets.

**Organization Schema:**
```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Your Company Name",
  "url": "https://example.com",
  "logo": "https://example.com/logo.png",
  "description": "One-sentence company description",
  "foundingDate": "2020",
  "sameAs": [
    "https://twitter.com/yourbrand",
    "https://linkedin.com/company/yourbrand",
    "https://facebook.com/yourbrand"
  ],
  "contactPoint": {
    "@type": "ContactPoint",
    "telephone": "+1-555-555-5555",
    "contactType": "customer service",
    "availableLanguage": ["English"]
  }
}
```

**Article Schema:**
```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Article Title with Primary Keyword",
  "description": "Brief description of the article",
  "image": "https://example.com/article-image.jpg",
  "author": {
    "@type": "Person",
    "name": "Author Name",
    "url": "https://example.com/about/author-name"
  },
  "publisher": {
    "@type": "Organization",
    "name": "Your Company",
    "logo": {
      "@type": "ImageObject",
      "url": "https://example.com/logo.png"
    }
  },
  "datePublished": "2024-01-15",
  "dateModified": "2024-03-01",
  "mainEntityOfPage": {
    "@type": "WebPage",
    "@id": "https://example.com/article-url"
  }
}
```

**Product Schema:**
```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Product Name",
  "description": "Product description",
  "image": "https://example.com/product-image.jpg",
  "brand": {
    "@type": "Brand",
    "name": "Your Brand"
  },
  "offers": {
    "@type": "Offer",
    "price": "99.00",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock",
    "url": "https://example.com/product"
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.7",
    "reviewCount": "523"
  }
}
```

**FAQPage Schema** (critical for GEO — see GEO section):
```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is [your product/topic]?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "A concise, authoritative answer that AI engines can cite directly. Include a statistic or specific data point for maximum AI visibility."
      }
    },
    {
      "@type": "Question",
      "name": "How does [product/topic] compare to [alternative]?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "A factual comparison with specific differentiators. Cite sources where possible."
      }
    },
    {
      "@type": "Question",
      "name": "How much does [product/topic] cost?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Direct answer with pricing details. Transparency improves AI citation rates."
      }
    }
  ]
}
```

**Other high-value schema types:**
- `HowTo` — Step-by-step guides (rich snippets in search)
- `LocalBusiness` — Local SEO (address, hours, reviews)
- `BreadcrumbList` — Site navigation path
- `VideoObject` — Video content (video carousels in search)
- `SoftwareApplication` — SaaS products (ratings, pricing in search)
- `Review` / `AggregateRating` — Star ratings in search results
- `Event` — Event listings with dates and locations

### On-Page SEO Content Checklist

For every piece of content published, verify:

- [ ] **H1 tag** contains the primary keyword (one H1 per page)
- [ ] **URL** is short, descriptive, and contains the primary keyword (e.g., `/seo-content-checklist`)
- [ ] **First 100 words** include the primary keyword naturally
- [ ] **Subheadings** (H2, H3) use semantic variations of the keyword
- [ ] **Image alt text** is descriptive and includes keywords where natural (not keyword-stuffed)
- [ ] **Internal links** — at least 3-5 internal links to related content
- [ ] **External links** — at least 1-2 links to authoritative external sources
- [ ] **Meta title** follows the template above
- [ ] **Meta description** follows the template above
- [ ] **Canonical tag** is set correctly
- [ ] **Mobile-friendly** — passes Google's Mobile-Friendly Test
- [ ] **Page speed** — LCP under 2.5s, FID under 100ms, CLS under 0.1
- [ ] **Content length** — at least 1,500 words for pillar content, 800+ for supporting pages
- [ ] **Schema markup** — appropriate JSON-LD for the content type
- [ ] **Image optimization** — WebP format, compressed, proper dimensions, lazy loaded
- [ ] **Table of contents** — for content over 2,000 words
- [ ] **Answer-first format** — lead section directly answers the primary query (critical for GEO)

### Core Web Vitals

| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| LCP (Largest Contentful Paint) | < 2.5s | 2.5-4.0s | > 4.0s |
| FID (First Input Delay) | < 100ms | 100-300ms | > 300ms |
| INP (Interaction to Next Paint) | < 200ms | 200-500ms | > 500ms |
| CLS (Cumulative Layout Shift) | < 0.1 | 0.1-0.25 | > 0.25 |

### Indexing Verification

Check indexing status:
- Google Search Console → URL Inspection Tool
- `site:example.com/page-url` in Google search
- Bing Webmaster Tools → URL Inspection

**Common indexing blockers:**
- `noindex` meta tag or HTTP header
- Blocked by `robots.txt`
- Canonical tag pointing to a different URL
- Page returns non-200 status code
- Page is orphaned (no internal links pointing to it)
- Low-quality or thin content (Google may choose not to index)

## Part 2: Generative Engine Optimization (GEO)

GEO is the practice of optimizing content to be cited and surfaced by AI-powered search engines (ChatGPT, Perplexity, Google AI Overviews, Microsoft Copilot, Claude).

### The 9 Princeton GEO Methods

Based on research from Princeton University on what increases content visibility in generative AI search results:

| Method | Visibility Boost | Implementation |
|--------|-----------------|----------------|
| Cite Sources | +40% | Link to and reference authoritative sources. Include inline citations. |
| Statistics Addition | +37% | Add specific data points, percentages, and numerical evidence. |
| Quotation Addition | +30% | Include expert quotes with attribution (name and title). |
| Authoritative Tone | +25% | Write with confidence. Avoid hedging language ("maybe," "possibly"). |
| Easy-to-Understand | +20% | Use clear, accessible language. Short sentences. Define technical terms. |
| Technical Terms | +18% | Use precise industry terminology alongside plain explanations. |
| Unique Words | +15% | Use varied, specific vocabulary. Avoid generic filler phrases. |
| Fluency Optimization | +15-30% | Improve readability, grammar, sentence flow. Well-structured content. |
| Keyword Stuffing | -10% (AVOID) | Repeating keywords unnaturally HURTS AI visibility. |

**Optimal combination: Fluency Optimization + Statistics Addition = Maximum visibility boost.**

Apply the top 5 methods (Cite Sources, Statistics, Quotations, Authoritative Tone, Easy-to-Understand) to every piece of content for maximum AI citation probability.

### Answer-First Content Format

AI engines prefer content that provides direct answers before elaboration. Structure content like this:

```markdown
## [Question as Heading]

[Direct, concise answer in 1-2 sentences — this is what AI will cite]

[Expanded explanation with context, nuance, and supporting details]

[Evidence: statistics, expert quotes, case studies]

[Related considerations or caveats]
```

**Example:**

```markdown
## How much does customer acquisition cost for SaaS companies?

The average customer acquisition cost (CAC) for SaaS companies is $205 for organic
channels and $341 for inorganic (paid) channels, according to a 2024 study by
FirstPageSage analyzing 350 SaaS companies.

CAC varies significantly by segment: enterprise SaaS averages $1,450 per customer
due to longer sales cycles and higher-touch sales processes, while self-serve
SaaS products average $45-$150 through product-led growth motions.

Key factors that influence SaaS CAC include...
```

This format is preferred because AI engines extract the direct answer from the first paragraph and can cite it with confidence.

### Platform-Specific Optimization

#### ChatGPT (GPT-4 + Browsing)

| Factor | Impact | Action |
|--------|--------|--------|
| Branded domain authority | High | Build brand mentions and citations across authoritative sites |
| Content freshness | High | Update content within 30 days for trending topics |
| Backlink volume | High | Sites with >350K referring domains average 8.4 citations per query |
| Structured content | Medium | Use clear headings, lists, tables, and FAQ format |
| Factual density | High | Include verifiable statistics and cite primary sources |

**ChatGPT-specific tactics:**
- Publish on domains with high domain authority or get featured on high-DA sites
- Update content regularly — ChatGPT's browsing prioritizes recent content
- Include your brand name naturally in content so ChatGPT attributes it correctly
- Create comprehensive, single-page resources rather than thin multi-page content
- Allow GPTBot in robots.txt (see bot list below)

#### Perplexity

| Factor | Impact | Action |
|--------|--------|--------|
| PerplexityBot access | Required | Must be allowed in robots.txt |
| FAQ Schema | High | FAQPage JSON-LD gets prioritized for citation |
| PDF documents | High | Perplexity can index and cite PDFs directly |
| Semantic relevance | High | Content must closely match query intent |
| Source diversity | Medium | Being cited across multiple domains increases trust |

**Perplexity-specific tactics:**
- Allow PerplexityBot in robots.txt (critical — if blocked, you're invisible)
- Implement FAQPage schema on all relevant pages
- Publish downloadable PDF whitepapers, guides, and reports — Perplexity indexes these
- Write content that directly answers specific questions (match query patterns)
- Include author credentials and expertise signals on the page

#### Google AI Overviews (SGE)

| Factor | Impact | Action |
|--------|--------|--------|
| E-E-A-T signals | Critical | Experience, Expertise, Authoritativeness, Trustworthiness |
| Structured data | High | Schema markup increases citation likelihood |
| Topical authority | High | Comprehensive coverage of a topic cluster |
| Authoritative citations | Very High | Pages with authoritative citations see +132% visibility in AI Overviews |
| Existing search ranking | High | Pages ranking in top 10 organic are most likely to be cited |

**Google AI Overviews tactics:**
- E-E-A-T is non-negotiable: author bios with credentials, cited sources, original research
- Build topical authority through content clusters (pillar page + supporting articles)
- Pages cited in AI Overviews usually already rank in the top 10 organic results — focus on traditional SEO first
- Include authoritative citations (academic papers, government data, industry reports) — this is the single highest-impact GEO factor for Google at +132% visibility
- Use structured data (FAQ, HowTo, Article schema) to help Google parse your content for AI Overviews

#### Microsoft Copilot

| Factor | Impact | Action |
|--------|--------|--------|
| Bing indexing | Required | Must be indexed in Bing (not just Google) |
| Microsoft ecosystem | Medium | Mentions of Microsoft products/integrations can help |
| Page speed | High | Pages loading under 2 seconds are preferred |
| Bing Webmaster Tools | Important | Submit sitemap and monitor indexing in Bing |
| Structured data | Medium | Schema markup recognized by Bing |

**Copilot-specific tactics:**
- Verify your site is indexed in Bing — submit your sitemap via Bing Webmaster Tools
- Optimize page speed aggressively — Copilot favors fast-loading pages (under 2 seconds)
- If relevant, mention compatibility with Microsoft products (Teams, 365, Azure, etc.)
- Allow BingBot in robots.txt
- Bing Places for Business for local results

#### Claude AI (via Brave Search)

| Factor | Impact | Action |
|--------|--------|--------|
| Brave Search indexing | Required | Content must be discoverable by Brave Search |
| High factual density | High | Claude prioritizes verifiable, factual content |
| Structural clarity | High | Clear headings, logical flow, explicit definitions |
| Source attribution | Medium | Cite and link to primary sources |
| Content depth | High | Comprehensive coverage preferred over thin content |

**Claude-specific tactics:**
- Ensure content is indexable by Brave Search (submit to Brave's Web Discovery Project if possible)
- Write with high factual density — specific numbers, dates, proper nouns, verifiable claims
- Structure content with clear hierarchy — H1 > H2 > H3 with logical information flow
- Define terms explicitly when introducing them
- Allow ClaudeBot in robots.txt

### AI Bot Access Configuration

#### Robots.txt for AI Visibility

Allow these AI bots to crawl your site:

```
# robots.txt — AI search engine bots

# Google (traditional + AI Overviews)
User-agent: Googlebot
Allow: /

# Bing (traditional + Copilot)
User-agent: Bingbot
Allow: /

# Perplexity
User-agent: PerplexityBot
Allow: /

# ChatGPT browsing
User-agent: ChatGPT-User
Allow: /

# OpenAI crawler (for training — decide if you want to allow)
User-agent: GPTBot
Allow: /

# Claude
User-agent: ClaudeBot
Allow: /

# Common crawlers that feed AI systems
User-agent: Applebot
Allow: /

# Sitemap
Sitemap: https://example.com/sitemap.xml
```

**Important decision: GPTBot vs. ChatGPT-User**
- `ChatGPT-User` — Browsing agent used when ChatGPT searches the web in real-time. Allowing this lets your content be cited in ChatGPT responses.
- `GPTBot` — OpenAI's crawler for training data. Allowing this lets your content be used for model training. Some sites block this while allowing ChatGPT-User.

#### Verifying Bot Access

Run these commands to audit your current configuration:

```bash
# Check robots.txt
curl -s "https://example.com/robots.txt"

# Check sitemap
curl -s "https://example.com/sitemap.xml" | head -50

# Check specific bot access
curl -s "https://example.com/robots.txt" | grep -i -A 2 "perplexity\|chatgpt\|gptbot\|claudebot\|bingbot"

# Validate a URL is not blocked for a specific bot
# Use Google's robots.txt tester or python robotparser
```

### GEO Content Strategy

#### Content Types That Get Cited by AI

Ranked by citation frequency:

1. **Definitive guides** — Comprehensive, single-page resources on a topic (highest citation rate)
2. **Data-driven research** — Original statistics, surveys, benchmarks (AI loves citing specific numbers)
3. **Expert roundups** — Curated expert opinions with attributed quotes
4. **Comparison pages** — "[Product A] vs [Product B]" with objective criteria
5. **Glossary/definition pages** — Clear definitions of industry terms
6. **FAQ pages** — Direct question-and-answer format with schema markup
7. **How-to guides** — Step-by-step instructions with specific details
8. **Case studies** — Specific customer results with quantified outcomes

#### The GEO Content Checklist

For every piece of content optimized for AI citation:

- [ ] **Answer-first format** — Direct answer in the first 1-2 sentences of each section
- [ ] **Statistics included** — At least 3-5 specific data points per article (+37% visibility)
- [ ] **Sources cited** — Inline citations linking to authoritative sources (+40% visibility)
- [ ] **Expert quotes** — At least 1-2 attributed quotes with name and title (+30% visibility)
- [ ] **Authoritative tone** — Confident, direct language without hedging (+25% visibility)
- [ ] **Clear structure** — H2/H3 headings that match natural question patterns
- [ ] **Tables and lists** — Structured data that AI can parse easily
- [ ] **FAQPage schema** — JSON-LD markup on pages with Q&A content (+40% AI visibility)
- [ ] **Author credentials** — Author bio with expertise, credentials, and links
- [ ] **Publication date** — Clearly visible and recent (within 30 days for time-sensitive topics)
- [ ] **Brand mentions** — Your brand name appears naturally 3-5 times in the content
- [ ] **Unique insights** — Original analysis, data, or perspective not found elsewhere

### FAQPage Schema for AI Visibility

FAQPage schema is one of the highest-impact GEO tactics, providing up to +40% AI visibility. Implement it on:

- Product pages (product-specific questions)
- Pricing pages (pricing and plan questions)
- Feature pages (how-it-works questions)
- Blog posts (topic-specific questions)
- Landing pages (objection-handling questions)

**Implementation template** (see JSON-LD in Part 1 above).

**FAQ content guidelines for AI:**
- Write questions exactly as users would ask them (conversational phrasing)
- Keep answers concise (2-4 sentences) for the schema, with expanded content on the page
- Include one statistic or specific data point per answer
- Cite a source in at least one answer
- Include 5-10 FAQ items per page (sweet spot for AI parsing)

## Part 3: SEO + GEO Audit Workflow

### Full Audit Checklist

#### Step 1: Technical Foundation

```
1. Check robots.txt
   curl -s "https://example.com/robots.txt"

   Verify:
   - [ ] Googlebot allowed
   - [ ] BingBot allowed
   - [ ] PerplexityBot allowed (or not blocked)
   - [ ] ChatGPT-User allowed
   - [ ] ClaudeBot allowed
   - [ ] GPTBot allowed (if desired)
   - [ ] Sitemap URL listed

2. Check sitemap
   curl -s "https://example.com/sitemap.xml" | head -50

   Verify:
   - [ ] Sitemap exists and is valid XML
   - [ ] All important pages are included
   - [ ] No 404 or redirected URLs in sitemap
   - [ ] Sitemap is submitted to Google Search Console and Bing Webmaster Tools
   - [ ] Last modified dates are accurate

3. Check indexing status
   - Google: site:example.com (note number of results)
   - Bing: site:example.com (note number of results)
   - Compare indexed pages vs. pages in sitemap
   - Identify important pages not indexed
```

#### Step 2: On-Page SEO Audit

```
For each key page, check:
- [ ] Title tag (unique, under 60 chars, keyword in first 30 chars)
- [ ] Meta description (unique, 150-160 chars, includes keyword)
- [ ] H1 tag (one per page, contains primary keyword)
- [ ] URL structure (short, descriptive, keyword-included)
- [ ] Internal links (3-5 per page)
- [ ] Image alt text (descriptive, keyword-natural)
- [ ] Canonical tag (correct self-reference or proper canonical)
- [ ] Mobile-friendly (responsive, no horizontal scroll)
- [ ] Page speed (LCP < 2.5s, CLS < 0.1)
```

#### Step 3: Structured Data Audit

```
Validate schema with: https://validator.schema.org/
or: https://search.google.com/test/rich-results

Check for:
- [ ] Organization schema on homepage
- [ ] Article schema on blog posts
- [ ] Product schema on product pages
- [ ] FAQPage schema on relevant pages
- [ ] BreadcrumbList schema site-wide
- [ ] No errors or warnings in validation
```

#### Step 4: GEO-Specific Audit

```
For top 20 pages by traffic, evaluate:
- [ ] Answer-first format used
- [ ] Statistics present (at least 3 per article)
- [ ] Sources cited with links
- [ ] Expert quotes with attribution
- [ ] Authoritative tone (no hedging language)
- [ ] FAQPage schema implemented
- [ ] Content updated within last 90 days
- [ ] Author bio with credentials
- [ ] Brand name mentioned naturally
```

#### Step 5: Competitive GEO Analysis

```
For your top 5 keywords, check:
- [ ] What does ChatGPT cite when asked about this topic?
- [ ] What does Perplexity cite?
- [ ] What appears in Google AI Overviews?
- [ ] What does Copilot reference?
- [ ] Are your competitors being cited? Which pages?
- [ ] What content format are cited pages using?
- [ ] What makes cited content different from your content?
```

### Priority Matrix for Optimization

| Action | SEO Impact | GEO Impact | Effort | Priority |
|--------|-----------|-----------|--------|----------|
| Fix robots.txt for AI bots | Low | Critical | Low | Do first |
| Add FAQPage schema | Medium | High (+40%) | Low | Do first |
| Add statistics to content | Low | High (+37%) | Medium | High |
| Cite authoritative sources | Medium | High (+40%) | Medium | High |
| Answer-first content format | Medium | High | Medium | High |
| Add expert quotes | Low | Medium (+30%) | Medium | Medium |
| Implement Article/Product schema | Medium | Medium | Low | Medium |
| Improve page speed | High | Medium | High | Medium |
| Build topical authority clusters | High | High | High | Ongoing |
| Update content freshness | Medium | High | Medium | Ongoing |

### Monitoring AI Citations

Track your brand's presence in AI search results:

1. **Manual monitoring** — Weekly, query your top 10 keywords in ChatGPT, Perplexity, Google AI Overviews, and Copilot. Record which sources are cited.
2. **Brand mention tracking** — Set up alerts for your brand name being mentioned in AI-generated content
3. **Referral traffic** — Monitor traffic from AI platforms in analytics (look for referrers like chat.openai.com, perplexity.ai)
4. **Citation tracking tools** — Emerging tools like Otterly.ai, Profound, and Peec AI track AI citations
5. **Content performance correlation** — Track which content attributes (statistics, citations, schema) correlate with AI citation

### Key Metrics to Track

| Metric | Tool | Frequency |
|--------|------|-----------|
| Organic traffic | GA4, Search Console | Weekly |
| Keyword rankings | Ahrefs, SEMrush | Weekly |
| Indexed pages | Search Console, Bing WMT | Monthly |
| Core Web Vitals | PageSpeed Insights, Search Console | Monthly |
| AI citation frequency | Manual audit + tools | Monthly |
| AI referral traffic | GA4 (referrer analysis) | Weekly |
| Schema validation | Rich Results Test | After changes |
| Backlink growth | Ahrefs, SEMrush | Monthly |
| Click-through rate | Search Console | Monthly |

### Common Mistakes to Avoid

1. **Blocking AI bots in robots.txt** — Many default robots.txt files block unknown bots. Check explicitly.
2. **No structured data** — Without schema, AI engines have harder time parsing your content for citations.
3. **Burying the answer** — AI engines extract from the first paragraph. Don't bury key information under long introductions.
4. **No statistics or citations** — The two highest-impact GEO factors (+40% and +37%) are free to implement.
5. **Stale content** — AI engines favor recently updated content, especially ChatGPT's browsing.
6. **Keyword stuffing** — Proven to reduce AI visibility by 10%. Write naturally.
7. **Ignoring Bing** — Copilot uses Bing's index. If you're not indexed in Bing, you're invisible to Copilot.
8. **No author credentials** — E-E-A-T signals matter for both Google and AI engines. Anonymous content gets cited less.
9. **Thin content** — AI engines prefer comprehensive, single-page resources over thin multi-page content.
10. **Optimizing for only one AI platform** — Each platform has different priorities. A well-rounded approach (statistics + citations + schema + freshness + structure) works across all of them.