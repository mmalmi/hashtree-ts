<script lang="ts">
  let { class: className = '' }: { class?: string } = $props();
</script>

<span class="flex items-center gap-2 {className}">
  <img src="/iris-logo.png" alt="Iris" class="w-8 h-8" draggable="false" />
  <span class="font-semibold text-text-1"><span class="text-accent">Iris</span> Files</span>
</span>
