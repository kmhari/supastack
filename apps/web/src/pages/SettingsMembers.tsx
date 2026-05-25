import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Clock, MoreVertical, Search, UserPlus, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { membersApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Shell } from '@/components/Shell';
import { SettingsLayout } from '@/components/SettingsLayout';
import { PageHeader } from '@/components/PageHeader';
import { CopyButton } from '@/components/CopyButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Member {
  userId: string;
  email: string;
  role: 'admin' | 'member';
  createdAt: string;
}
interface Invite {
  id: string;
  email: string;
  role: 'admin' | 'member';
  expiresAt: string;
}
interface InviteCreated {
  id: string;
  email: string;
  role: 'admin' | 'member';
  link: string;
  expiresAt: string;
}

export function SettingsMembersPage(): React.ReactElement {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'admin';

  const { data: members = [], isLoading } = useQuery<Member[]>({
    queryKey: ['members'],
    queryFn: () => membersApi.list() as Promise<Member[]>,
  });
  const { data: invites = [] } = useQuery<Invite[]>({
    queryKey: ['invites'],
    queryFn: () => membersApi.listInvites() as Promise<Invite[]>,
    enabled: isAdmin,
  });

  const [filter, setFilter] = useState('');
  const filtered = useMemo(
    () =>
      members.filter((m) =>
        filter ? m.email.toLowerCase().includes(filter.toLowerCase()) : true,
      ),
    [members, filter],
  );

  const [inviteOpen, setInviteOpen] = useState(false);

  const removeMember = useMutation({
    mutationFn: (userId: string) => membersApi.remove(userId),
    onSuccess: () => {
      toast.success('Member removed');
      qc.invalidateQueries({ queryKey: ['members'] });
    },
  });

  const revokeInvite = useMutation({
    mutationFn: (id: string) => membersApi.revokeInvite(id),
    onSuccess: () => {
      toast.success('Invite revoked');
      qc.invalidateQueries({ queryKey: ['invites'] });
    },
  });

  return (
    <Shell bare>
      <SettingsLayout>
        <PageHeader title="Members" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter members"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isAdmin && (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus className="size-3.5" />
              Invite members
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border-soft bg-card">
        <div className="grid grid-cols-[1fr_180px_180px_120px] gap-4 border-b border-border-soft px-6 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <div>Member</div>
          <div>Role</div>
          <div>Joined</div>
          <div />
        </div>

        {isLoading ? (
          <p className="px-6 py-5 text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-5 text-muted-foreground">
            {filter ? 'No members match your filter.' : 'No members yet.'}
          </p>
        ) : (
          filtered.map((m, i) => (
            <MemberRow
              key={m.userId}
              member={m}
              isYou={m.userId === user?.userId}
              first={i === 0}
              canRemove={isAdmin && m.userId !== user?.userId}
              onRemove={() => {
                if (confirm(`Remove ${m.email}? Tokens and sessions will be invalidated.`))
                  removeMember.mutate(m.userId);
              }}
            />
          ))
        )}
      </div>

      {isAdmin && invites.length > 0 && (
        <>
          <h2 className="mt-10 mb-3 text-base font-medium text-foreground">
            Pending invites ({invites.length})
          </h2>
          <div className="overflow-hidden rounded-lg border border-border-soft bg-card">
            <div className="grid grid-cols-[1fr_180px_180px_120px] gap-4 border-b border-border-soft px-6 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <div>Email</div>
              <div>Role</div>
              <div>Expires</div>
              <div />
            </div>
            {invites.map((i, idx) => (
              <div
                key={i.id}
                className={`grid grid-cols-[1fr_180px_180px_120px] items-center gap-4 px-6 py-4 ${idx > 0 ? 'border-t border-border-soft' : ''}`}
              >
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <span className="flex size-7 items-center justify-center rounded-full border border-border bg-secondary/60">
                    <Clock className="size-3.5 text-muted-foreground" />
                  </span>
                  {i.email}
                </div>
                <div className="text-sm text-foreground">{i.role}</div>
                <div className="text-sm text-muted-foreground">
                  {new Date(i.expiresAt).toLocaleDateString()}
                </div>
                <div className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => revokeInvite.mutate(i.id)}
                  >
                    Revoke
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['invites'] })}
      />
      </SettingsLayout>
    </Shell>
  );
}

function MemberRow({
  member,
  isYou,
  first,
  canRemove,
  onRemove,
}: {
  member: Member;
  isYou: boolean;
  first: boolean;
  canRemove: boolean;
  onRemove: () => void;
}): React.ReactElement {
  return (
    <div
      className={`grid grid-cols-[1fr_180px_180px_120px] items-center gap-4 px-6 py-4 ${first ? '' : 'border-t border-border-soft'}`}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-7 items-center justify-center rounded-full border border-border bg-secondary/60">
          <UserRound className="size-3.5 text-muted-foreground" />
        </span>
        <span className="text-sm text-foreground">{member.email}</span>
        {isYou && <Badge variant="outline">You</Badge>}
      </div>
      <div className="text-sm text-foreground">
        {member.role === 'admin' ? 'Admin' : 'Member'}
      </div>
      <div className="text-sm text-muted-foreground">
        {new Date(member.createdAt).toLocaleDateString()}
      </div>
      <div className="flex justify-end">
        {canRemove && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="member actions">
                <MoreVertical className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                onSelect={(e) => {
                  e.preventDefault();
                  onRemove();
                }}
              >
                Remove member
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}): React.ReactElement {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [newLink, setNewLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createInvite = useMutation({
    mutationFn: (body: { email: string; role: 'admin' | 'member' }) =>
      membersApi.invite(body) as Promise<InviteCreated>,
    onSuccess: (data) => {
      setNewLink(data.link);
      onSuccess();
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      setError(e.response?.data?.error?.message ?? 'invite failed');
    },
  });

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    setError(null);
    setNewLink(null);
    createInvite.mutate({ email, role });
  };

  const reset = (): void => {
    setEmail('');
    setRole('member');
    setNewLink(null);
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>
            Send a one-time invite link. Valid for 24 hours.
          </DialogDescription>
        </DialogHeader>

        {!newLink ? (
          <form onSubmit={onSubmit} className="grid gap-4">
            <div>
              <Label htmlFor="invite-email" className="mb-1.5 block text-sm text-foreground-light">
                Email
              </Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="invitee@example.com"
                autoFocus
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm text-foreground-light">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'member')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member — read access only</SelectItem>
                  <SelectItem value="admin">Admin — full access</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createInvite.isPending}>
                {createInvite.isPending ? 'Sending…' : 'Send invite'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="grid gap-3">
            <Alert>
              <AlertDescription>
                <p className="m-0 mb-2 text-foreground">
                  Invite link for <strong>{email}</strong>:
                </p>
                <code className="block break-all rounded border border-border-soft bg-background p-2 font-mono text-xs text-success">
                  {newLink}
                </code>
              </AlertDescription>
            </Alert>
            <div className="flex justify-end gap-2">
              <CopyButton value={newLink} label="Copy link" variant="outline" />
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
