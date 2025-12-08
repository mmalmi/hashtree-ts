<script lang="ts">
  /**
   * FollowsPage - list of followed users
   * Placeholder for now
   */
  interface Props {
    npub?: string;
  }

  let { npub }: Props = $props();
</script>

<div class="flex-1 flex flex-col min-h-0 bg-surface-0 p-6">
  <h1 class="text-xl font-semibold mb-4">Following</h1>
  <p class="text-muted">Follows page for {npub || 'user'}</p>
</div>
