<script setup>
import {useWorkspace} from '../context';
import RequestWorkbench from '../RequestWorkbench.vue';
const {state}=useWorkspace();
</script><template><RequestWorkbench :state="state"/></template>