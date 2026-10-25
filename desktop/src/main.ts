import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { choice } from './directives/choice';
import './styles/app.css';
import './styles/native-layout.css';
import './styles/controls.css';
createApp(App).use(createPinia()).directive('choice', choice).mount('#app');
