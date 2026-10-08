const header = document.querySelector('[data-header]');
const menuToggle = document.querySelector('[data-menu-toggle]');
const nav = document.querySelector('[data-nav]');
const navLinks = nav?.querySelectorAll('a') ?? [];

const updateHeader = () => {
  header?.classList.toggle('scrolled', window.scrollY > 24);
};

const closeMenu = () => {
  menuToggle?.setAttribute('aria-expanded', 'false');
  nav?.classList.remove('open');
  document.body.style.overflow = '';
};

menuToggle?.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!isOpen));
  nav?.classList.toggle('open', !isOpen);
  document.body.style.overflow = isOpen ? '' : 'hidden';
});

navLinks.forEach((link) => link.addEventListener('click', closeMenu));
window.addEventListener('scroll', updateHeader, { passive: true });
window.addEventListener('resize', () => {
  if (window.innerWidth > 680) closeMenu();
});
updateHeader();

const revealObserver = new IntersectionObserver((entries, observer) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('visible');
    observer.unobserve(entry.target);
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element));

const copyButton = document.querySelector('[data-copy]');
copyButton?.addEventListener('click', async () => {
  const command = 'git clone https://github.com/sirius93/cope.git && cd cope && corepack enable && pnpm install --frozen-lockfile && pnpm cope run examples/post.md --all';

  try {
    await navigator.clipboard.writeText(command);
    const original = copyButton.innerHTML;
    copyButton.innerHTML = 'Copied! ✓';
    window.setTimeout(() => {
      copyButton.innerHTML = original;
    }, 1800);
  } catch {
    copyButton.textContent = 'Copy unavailable';
  }
});

document.querySelector('[data-year]').textContent = new Date().getFullYear();
