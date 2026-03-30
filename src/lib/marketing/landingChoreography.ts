import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { CaveLandingSceneApi } from '$lib/marketing/caveLandingScene';
import type { LandingAudioApi } from '$lib/marketing/landingAudio';

export interface LandingChoreographyConfig {
  root: HTMLElement;
  sceneApi: CaveLandingSceneApi;
  reducedMotion: boolean;
  audioApi?: LandingAudioApi | null;
}

export function createLandingChoreography(config: LandingChoreographyConfig): () => void {
  const { root, sceneApi, reducedMotion, audioApi } = config;
  gsap.registerPlugin(ScrollTrigger);

  const ctx = gsap.context(() => {
    const titleLines = root.querySelectorAll('.hero-title-line');
    const introItems = root.querySelectorAll('.intro-fade');
    const chapterEls = root.querySelectorAll<HTMLElement>('.chapter');
    const sectionTitles = root.querySelectorAll('.chapter-title .line-text');

    if (reducedMotion) {
      gsap.set([...introItems, ...titleLines, ...sectionTitles], { clearProps: 'all' });
      return;
    }

    gsap.set(introItems, { opacity: 0, y: 18 });
    gsap.set(titleLines, { yPercent: 108 });
    gsap.set(sectionTitles, { yPercent: 108 });

    const introTl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    introTl.to(introItems, { opacity: 1, y: 0, duration: 0.72, stagger: 0.1 }, 0.2);
    introTl.to(titleLines, { yPercent: 0, duration: 0.72, stagger: 0.16, ease: 'power3.out' }, 0.8);

    gsap.to('.canvas-vignette', {
      opacity: 0.82,
      ease: 'none',
      scrollTrigger: {
        trigger: root,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 1
      }
    });

    gsap.to('.greek-watermark', {
      yPercent: -14,
      opacity: 0.03,
      ease: 'none',
      scrollTrigger: {
        trigger: root,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 1
      }
    });

    for (const chapter of chapterEls) {
      const chapterIndex = Number(chapter.dataset.chapter ?? 0);
      const intensity = Number(chapter.dataset.intensity ?? 0.5);

      ScrollTrigger.create({
        trigger: chapter,
        start: 'top 55%',
        end: 'bottom 45%',
        onEnter: () => {
          sceneApi.setChapter(chapterIndex);
          sceneApi.setIntensity(intensity);
          audioApi?.setChapter(chapterIndex);
        },
        onEnterBack: () => {
          sceneApi.setChapter(chapterIndex);
          sceneApi.setIntensity(intensity);
          audioApi?.setChapter(chapterIndex);
        }
      });

      gsap.to(chapter, {
        opacity: 1,
        y: 0,
        duration: 0.7,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: chapter,
          start: 'top 78%'
        }
      });
    }

    gsap.to(sectionTitles, {
      yPercent: 0,
      duration: 0.62,
      stagger: 0.14,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: '.story',
        start: 'top 70%'
      }
    });

    ScrollTrigger.create({
      trigger: root,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => {
        const progress = self.progress;
        sceneApi.setScrollProgress(progress);
        audioApi?.setDepth(progress);
      }
    });
  }, root);

  return () => {
    ctx.revert();
    ScrollTrigger.getAll().forEach((t) => t.kill());
  };
}
