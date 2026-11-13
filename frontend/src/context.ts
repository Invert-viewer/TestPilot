import {inject,type InjectionKey} from 'vue';
import {usePreview} from './preview';
import {useSharedWorkspace} from './composables/useSharedWorkspace';
export type Workspace=ReturnType<typeof usePreview>&ReturnType<typeof useSharedWorkspace>&{newTask:(siteId?:string)=>void};
export const workspaceKey:InjectionKey<Workspace>=Symbol('workspace');
export function useWorkspace():Workspace {const value=inject(workspaceKey);if(!value)throw new Error('Workspace not provided');return value;}
