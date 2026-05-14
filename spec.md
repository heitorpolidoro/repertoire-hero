# Product Requirements Document (PRD) - Repertoire Hero

## 1. Problem Statement
Musicians often lose time organizing songs across different platforms (folders, links, paper) and lack a clear view of their learning progress, which hinders performance and rehearsal planning.

## 2. Audience
- Individual musicians (amateur or professional).
- Bands that need to align their repertoire for live shows.

## 3. Functional Requirements
### 3.1 Management
- **Songs:** CRUD operations for songs with the following initial fields:
    - **Title** (Required)
    - **Artist**
    - **Key**
    - **Links** (URLs for chords, lyrics, or videos)
- **Progress Status:** A 5-level scale to track mastery:
    1. `Unknown` (Don't know it yet)
    2. `Learning` (Just started)
    3. `Practicing` (Developing fluency)
    4. `Polishing` (Almost ready/fine-tuning)
    5. `Mastered` (Fully mastered)
- **Tags:** Flexible categorization (e.g., Genre, Setlist) using a tag-based system.

### 3.2 Access & UX
- **Search:** Instant search by title or artist.
- **Filter:** Filter songs by Status or Tags.
- **Fast View:** Reading mode optimized for mobile devices (for use on music stands).

### 3.3 Auth & Environment
- **Login:** Support for Email/Password.
- **Local Dev Experience:** Auto-login for `heitor.polidoro@gmail.com` in development environments.
- **Local Seed:** Initial data for immediate testing.

### 3.4 Future Expansion (Roadmap)
- **Playlists:** Ability for users to create personal collections of songs.
- **Band Mode:** 
    - Shared playlists for bands/groups.
    - **Aggregate Progress:** Band song status derived from all members' individual progress.
    - **Band-Specific Tags:** Exclusive tags for songs within a band context.

## 4. Constraints
- Responsive or cross-platform (Mobile + Desktop).
- Mandatory Backend for secure persistence and synchronization.

## 5. Success Criteria
- User can register a song and update its status in under 15 seconds.
- User can instantly filter all "Mastered" songs.
