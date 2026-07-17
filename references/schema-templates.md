# Schema Markup Templates — Ready-to-Use JSON-LD

## What is Schema? (Plain English)
Schema markup is code you add to your website pages that tells Google extra information 
about your business. It can make your listings in Google look richer — with stars, 
FAQs, or business hours shown directly in search results.

## How to Add Schema in WordPress
```
Option 1: Yoast SEO Premium → Schema tab on each page
Option 2: RankMath → Schema Builder
Option 3: Manual → Add to page's <head> using a plugin like "Insert Headers and Footers"
Option 4: Via WordPress REST API → Add to page content or custom fields
```

---

## 1. LocalBusiness Schema
Use on: Every page of a local business website (especially homepage and location pages)

```json
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Plumber",
  "name": "Austin Plumbing Pro",
  "image": "https://yoursite.com/logo.jpg",
  "@id": "https://yoursite.com/#business",
  "url": "https://yoursite.com",
  "telephone": "+15125550123",
  "priceRange": "$$",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "123 Main Street, Suite 4",
    "addressLocality": "Austin",
    "addressRegion": "TX",
    "postalCode": "78701",
    "addressCountry": "US"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 30.2672,
    "longitude": -97.7431
  },
  "openingHoursSpecification": [
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      "opens": "08:00",
      "closes": "18:00"
    },
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": "Saturday",
      "opens": "09:00",
      "closes": "14:00"
    }
  ],
  "sameAs": [
    "https://www.facebook.com/yourpage",
    "https://www.yelp.com/biz/yourbiz",
    "https://g.page/yourgbppage"
  ],
  "areaServed": [
    {"@type": "City", "name": "Austin"},
    {"@type": "City", "name": "Round Rock"},
    {"@type": "City", "name": "Cedar Park"}
  ],
  "hasOfferCatalog": {
    "@type": "OfferCatalog",
    "name": "Plumbing Services",
    "itemListElement": [
      {
        "@type": "Offer",
        "itemOffered": {
          "@type": "Service",
          "name": "Emergency Plumbing Repair"
        }
      },
      {
        "@type": "Offer",
        "itemOffered": {
          "@type": "Service",
          "name": "Water Heater Installation"
        }
      }
    ]
  }
}
</script>
```

**Replace these values:**
- `"@type": "Plumber"` → Find your specific type at: https://schema.org/LocalBusiness (subtypes include: Restaurant, MedicalBusiness, LegalService, AutoRepair, etc.)
- All business details with your actual information
- `sameAs` array with your actual social/directory URLs
- `areaServed` with your actual service areas
- `hasOfferCatalog` with your actual services

---

## 2. Organization Schema
Use on: Homepage only

```json
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Austin Plumbing Pro",
  "url": "https://yoursite.com",
  "logo": {
    "@type": "ImageObject",
    "url": "https://yoursite.com/logo.png",
    "width": 200,
    "height": 60
  },
  "contactPoint": {
    "@type": "ContactPoint",
    "telephone": "+15125550123",
    "contactType": "customer service",
    "availableLanguage": "English"
  },
  "sameAs": [
    "https://www.facebook.com/yourpage",
    "https://twitter.com/yourhandle",
    "https://www.linkedin.com/company/yourcompany"
  ]
}
</script>
```

---

## 3. FAQPage Schema
Use on: Service pages, FAQ pages (gets FAQ accordion in Google results — great CTR boost!)

```json
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "How much does a plumber cost in Austin?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Plumbing costs in Austin typically range from $75-$200 per hour depending on the job type. Emergency calls and weekend service may have additional fees. We offer free estimates for most jobs."
      }
    },
    {
      "@type": "Question",
      "name": "Do you offer emergency plumbing services?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes, we offer 24/7 emergency plumbing services in Austin and surrounding areas. Call us anytime at (512) 555-0123 for urgent plumbing issues."
      }
    },
    {
      "@type": "Question",
      "name": "Are your plumbers licensed in Texas?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes, all our plumbers are fully licensed by the Texas State Board of Plumbing Examiners and carry full liability insurance."
      }
    }
  ]
}
</script>
```

**How to use:** Add 3-8 questions that real customers ask. Must match FAQ content on the visible page.

---

## 4. BreadcrumbList Schema
Use on: All interior pages (not homepage)

```json
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "name": "Home",
      "item": "https://yoursite.com/"
    },
    {
      "@type": "ListItem",
      "position": 2,
      "name": "Services",
      "item": "https://yoursite.com/services/"
    },
    {
      "@type": "ListItem",
      "position": 3,
      "name": "Water Heater Repair",
      "item": "https://yoursite.com/services/water-heater-repair/"
    }
  ]
}
</script>
```

---

## 5. Article/BlogPosting Schema
Use on: Blog posts and articles

```json
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "How to Fix a Leaky Faucet: Step-by-Step Guide",
  "image": "https://yoursite.com/blog/leaky-faucet-repair.jpg",
  "author": {
    "@type": "Person",
    "name": "John Smith",
    "url": "https://yoursite.com/team/john-smith/"
  },
  "publisher": {
    "@type": "Organization",
    "name": "Austin Plumbing Pro",
    "logo": {
      "@type": "ImageObject",
      "url": "https://yoursite.com/logo.png"
    }
  },
  "datePublished": "2024-03-15",
  "dateModified": "2024-03-15",
  "description": "Learn how to fix a leaky faucet yourself with this step-by-step guide from professional Austin plumbers.",
  "mainEntityOfPage": {
    "@type": "WebPage",
    "@id": "https://yoursite.com/blog/fix-leaky-faucet/"
  }
}
</script>
```

---

## 6. Review / AggregateRating Schema
Use on: Homepage, service pages where you display reviews

```json
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Austin Plumbing Pro",
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.9",
    "reviewCount": "127",
    "bestRating": "5",
    "worstRating": "1"
  },
  "review": [
    {
      "@type": "Review",
      "author": {
        "@type": "Person",
        "name": "Sarah M."
      },
      "datePublished": "2024-02-10",
      "reviewRating": {
        "@type": "Rating",
        "ratingValue": "5",
        "bestRating": "5"
      },
      "reviewBody": "Excellent service! They fixed our emergency pipe burst quickly and the pricing was very fair. Highly recommend!"
    }
  ]
}
</script>
```

⚠️ **Important**: Only display reviews that are actually shown on the page. Don't add review schema for reviews that users can't see.

---

## 7. WebSite Schema (Sitelinks Searchbox)
Use on: Homepage only — enables a search box to appear under your Google listing

```json
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Austin Plumbing Pro",
  "url": "https://yoursite.com/",
  "potentialAction": {
    "@type": "SearchAction",
    "target": {
      "@type": "EntryPoint",
      "urlTemplate": "https://yoursite.com/?s={search_term_string}"
    },
    "query-input": "required name=search_term_string"
  }
}
</script>
```

---

## How to Test Schema

After adding any schema:
1. **Rich Results Test**: https://search.google.com/test/rich-results
   - Paste your URL
   - See if schema is detected and valid
   
2. **Schema Markup Validator**: https://validator.schema.org/
   - Paste your JSON-LD code
   - Check for errors

3. **GSC Enhancements**: 
   - After 1-2 weeks, check GSC → Enhancements
   - See impressions from rich results

---

## WordPress Implementation via REST API

```javascript
// Add schema to a WordPress page via REST API
// Add JSON-LD to the page content or use a custom field

// Option: Add to custom field 'custom_schema'
await fetch(`${siteUrl}/wp-json/wp/v2/pages/${pageId}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${btoa(username + ':' + appPassword)}`
  },
  body: JSON.stringify({
    meta: {
      custom_schema: JSON.stringify(schemaObject)
    }
  })
});
```
