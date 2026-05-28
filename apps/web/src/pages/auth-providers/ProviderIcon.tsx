import { cn } from '@/lib/utils';

const ICON_FILE: Record<string, string> = {
  email: 'email-icon2.svg',
  phone: 'phone-icon4.svg',
  saml: 'saml-icon.svg',
  web3: 'web3-icon.svg',
  apple: 'apple-icon.svg',
  azure: 'microsoft-icon.svg',
  bitbucket: 'bitbucket-icon.svg',
  discord: 'discord-icon.svg',
  facebook: 'facebook-icon.svg',
  figma: 'figma-icon.svg',
  github: 'github-icon.svg',
  gitlab: 'gitlab-icon.svg',
  google: 'google-icon.svg',
  kakao: 'kakao-icon.svg',
  keycloak: 'keycloak-icon.svg',
  linkedin: 'linkedin-icon.svg',
  notion: 'notion-icon.svg',
  twitch: 'twitch-icon.svg',
  x: 'x-icon.svg',
  twitter: 'twitter-icon.svg',
  slack: 'slack-icon.svg',
  'slack-oidc': 'slack-icon.svg',
  spotify: 'spotify-icon.svg',
  workos: 'workos-icon.svg',
  zoom: 'zoom-icon.svg',
};

export function ProviderIcon({
  name,
  size = 'md',
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
}): React.ReactElement {
  const file = ICON_FILE[name];
  const sizeClass =
    size === 'sm' ? 'size-5' : size === 'lg' ? 'size-8' : 'size-6';

  if (!file) {
    return (
      <div
        aria-hidden
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold text-secondary-foreground',
          sizeClass,
        )}
      >
        {(name[0] ?? '?').toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={`/provider-icons/${file}`}
      alt=""
      aria-hidden
      className={cn('shrink-0 object-contain', sizeClass)}
    />
  );
}
