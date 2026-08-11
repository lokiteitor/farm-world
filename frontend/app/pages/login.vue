<script setup lang="ts">
// Authentication: registration and sign in, with no canvas mounted.
//
// Owner: W3-C (it replaces the W1 scaffolding page).
//
// The form validates with the same Zod schemas the server validates with
// (`registerBodySchema`, `loginBodySchema`), so a field is refused here for the reason the
// server would refuse it and the password policy is not restated in the client. That is the
// fifth rule of shared/api/README.md section 7, and it is the reason the error of a failed
// submission is translated from `code` through the shared message table rather than from the
// text that arrived on the wire.
import { computed, ref } from 'vue';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import { apiOpenSession } from '~/net/api';
import { isApiClientError } from '~/net/errors';
import { apiErrorMessage, loginBodySchema, registerBodySchema } from '~/shared/index';
import { usePlayerStore } from '~/stores/player';

definePageMeta({ layout: 'auth' });

const player = usePlayerStore();

const mode = ref<'login' | 'register'>('login');
const email = ref('');
const password = ref('');
const displayName = ref('');
const submitting = ref(false);
const failure = ref<string | null>(null);

const isRegister = computed(() => mode.value === 'register');

/** The verdict of the schema of the route that would be called. */
const validation = computed(() => {
  if (isRegister.value) {
    return registerBodySchema.safeParse({
      email: email.value,
      password: password.value,
      displayName: displayName.value,
    });
  }
  return loginBodySchema.safeParse({ email: email.value, password: password.value });
});

const valid = computed(() => validation.value.success);

/** The first problem of the form, in Spanish, or null. Shown only once something was typed. */
const formProblem = computed(() => {
  const result = validation.value;
  if (result.success) {
    return null;
  }
  if (email.value.length === 0 && password.value.length === 0) {
    return null;
  }
  const issue = result.error.issues[0];
  if (issue === undefined) {
    return null;
  }
  const field = issue.path.join('.');
  if (field === 'email') {
    return 'La direccion de correo no es valida.';
  }
  if (field === 'password') {
    return 'La contrasena necesita al menos diez caracteres.';
  }
  if (field === 'displayName') {
    return 'El nombre visible no puede quedar vacio.';
  }
  return 'Los datos del formulario no son validos.';
});

function switchMode(): void {
  mode.value = isRegister.value ? 'login' : 'register';
  failure.value = null;
}

async function submit(): Promise<void> {
  if (!valid.value || submitting.value) {
    return;
  }
  submitting.value = true;
  failure.value = null;
  try {
    const reply = isRegister.value
      ? await apiOpenSession('POST /api/auth/register', {
          email: email.value,
          password: password.value,
          displayName: displayName.value,
        })
      : await apiOpenSession('POST /api/auth/login', {
          email: email.value,
          password: password.value,
        });
    player.applyPlayer(reply.player);
    player.setFirstSession(reply.firstSession);
    await navigateTo('/game');
  } catch (error) {
    failure.value = isApiClientError(error)
      ? apiErrorMessage(error.code)
      : 'No se pudo contactar con el servidor.';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <UiCard
    :title="isRegister ? 'Crear cuenta' : 'Iniciar sesion'"
    subtitle="Farming Management Simulator Online"
  >
    <form class="fw-login" @submit.prevent="submit">
      <label class="fw-login__field">
        <span>Correo</span>
        <input v-model="email" type="email" autocomplete="email" required />
      </label>

      <label v-if="isRegister" class="fw-login__field">
        <span>Nombre visible</span>
        <input v-model="displayName" type="text" autocomplete="nickname" required />
      </label>

      <label class="fw-login__field">
        <span>Contrasena</span>
        <input
          v-model="password"
          type="password"
          :autocomplete="isRegister ? 'new-password' : 'current-password'"
          required
        />
        <span class="fw-small fw-muted">Diez caracteres como minimo.</span>
      </label>

      <p v-if="formProblem !== null" class="fw-login__problem fw-small">{{ formProblem }}</p>
      <p v-if="failure !== null" class="fw-login__problem fw-small">{{ failure }}</p>

      <UiButton type="submit" variant="primary" :disabled="!valid" :busy="submitting">
        {{ isRegister ? 'Crear la cuenta' : 'Entrar' }}
      </UiButton>
    </form>

    <template #footer>
      <UiButton size="sm" variant="ghost" @click="switchMode">
        {{ isRegister ? 'Ya tengo cuenta' : 'Crear una cuenta nueva' }}
      </UiButton>
    </template>
  </UiCard>
</template>

<style scoped>
.fw-login {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fw-login__field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.fw-login__field input {
  padding: 6px 8px;
  border: 1px solid var(--fw-border-strong, #48525f);
  border-radius: var(--fw-radius, 4px);
  background: var(--fw-surface-sunken, #101318);
}

.fw-login__problem {
  margin: 0;
  color: var(--fw-danger, #b4544a);
}
</style>
