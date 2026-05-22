import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Shared "re-authenticate to reveal secrets" dialog. Wraps the state
 * exposed by useRevealCredentials so any settings page that needs to
 * gate a secret can drop this in.
 */
export function RevealDialog({
  open,
  onOpenChange,
  password,
  onPasswordChange,
  onSubmit,
  error,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  password: string;
  onPasswordChange: (p: string) => void;
  onSubmit: () => void;
  error: string | null;
  pending: boolean;
}): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Re-authenticate</DialogTitle>
          <DialogDescription>
            Enter your password to reveal project credentials. The action is recorded in the audit
            log.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="reveal-pw" className="mb-1.5 block text-sm text-foreground-light">
            Your password
          </Label>
          <Input
            id="reveal-pw"
            type="password"
            placeholder="your password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSubmit();
              }
            }}
            autoFocus
          />
          {error && (
            <Alert variant="destructive" className="mt-3">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={pending}>
            {pending ? 'Verifying…' : 'Reveal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
