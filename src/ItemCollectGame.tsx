import {
  Engine,
  Entity,
  EntityUUID,
  SimulationSystemGroup,
  UUIDComponent,
  createEntity,
  defineComponent,
  defineQuery,
  defineSystem,
  getComponent,
  setComponent
} from '@ir-engine/ecs'
import { AvatarComponent } from '@ir-engine/engine/src/avatar/components/AvatarComponent'
import { PrimitiveGeometryComponent } from '@ir-engine/engine/src/scene/components/PrimitiveGeometryComponent'
import { ShadowComponent } from '@ir-engine/engine/src/scene/components/ShadowComponent'
import { GeometryTypeEnum } from '@ir-engine/engine/src/scene/constants/GeometryTypeEnum'
import {
  UserID,
  defineAction,
  defineState,
  dispatchAction,
  getMutableState,
  matches,
  useImmediateEffect,
  useMutableState
} from '@ir-engine/hyperflux'
import { NetworkState, WorldNetworkAction, matchesUserID } from '@ir-engine/network'
import { TransformComponent } from '@ir-engine/spatial'
import { setCallback } from '@ir-engine/spatial/src/common/CallbackComponent'
import { NameComponent } from '@ir-engine/spatial/src/common/NameComponent'
import { ColliderComponent } from '@ir-engine/spatial/src/physics/components/ColliderComponent'
import { RigidBodyComponent } from '@ir-engine/spatial/src/physics/components/RigidBodyComponent'
import { TriggerComponent } from '@ir-engine/spatial/src/physics/components/TriggerComponent'
import { CollisionGroups } from '@ir-engine/spatial/src/physics/enums/CollisionGroups'
import { BodyTypes, Shapes } from '@ir-engine/spatial/src/physics/types/PhysicsTypes'
import { SceneComponent } from '@ir-engine/spatial/src/renderer/components/SceneComponents'
import { VisibleComponent } from '@ir-engine/spatial/src/renderer/components/VisibleComponent'
import { SpawnObjectActions } from '@ir-engine/spatial/src/transform/SpawnObjectActions'
import { EntityTreeComponent, getAncestorWithComponents } from '@ir-engine/spatial/src/transform/components/EntityTree'
import React from 'react'
import { MathUtils, Quaternion, Vector3 } from 'three'

const ValidItemColors = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'brown'] as const

const ItemActions = {
  spawn: defineAction(
    SpawnObjectActions.spawnObject.extend({
      type: 'ir.example.ItemCollectGame.ItemActions.spawn',
      color: matches.literals(...ValidItemColors)
    })
  ),

  destroy: defineAction(
    WorldNetworkAction.destroyEntity.extend({
      type: 'ir.example.ItemCollectGame.ItemActions.destroy',
      userID: matchesUserID // The user who collected the item
    })
  )
}

/**
 * This state will keep track of how many items each user has collected
 */
const ScoreState = defineState({
  name: 'ir.example.ItemCollectGame.ScoreState',
  initial: {} as Record<UserID, number>,

  receptors: {
    onCollectItem: ItemActions.destroy.receive((action) => {
      const state = getMutableState(ScoreState)
      if (typeof state[action.userID].value === 'undefined') state[action.userID].set(1)
      else state[action.userID].set((val) => val + 1)
    })
  }
})

/**
 * This state holds active items in the game
 */
const ItemState = defineState({
  name: 'ir.example.ItemState',
  initial: {} as Record<EntityUUID, string>,

  receptors: {
    onCollectItem: ItemActions.spawn.receive((action) => {
      getMutableState(ItemState)[action.entityUUID].set(action.color)
    })
  },

  reactor: () => {
    const items = useMutableState(ItemState).keys
    return (
      <>
        {items.map((entityUUID: EntityUUID) => (
          <ItemReactor key={entityUUID} entityUUID={entityUUID} />
        ))}
      </>
    )
  }
})

const ItemReactor = (props: { entityUUID: EntityUUID }) => {
  const entity = UUIDComponent.useEntityByUUID(props.entityUUID)

  useImmediateEffect(() => {
    if (!entity) return

    setComponent(entity, ItemComponent)
    setComponent(entity, VisibleComponent, true)
    setComponent(entity, RigidBodyComponent, { type: BodyTypes.Fixed })
    setComponent(entity, NameComponent, 'item')
    setCallback(entity, 'onCollectItem', (triggerEntity: Entity, otherEntity: Entity) => {
      if (otherEntity !== AvatarComponent.getSelfAvatarEntity()) return
      dispatchAction(ItemActions.destroy({ entityUUID: props.entityUUID, userID: Engine.instance.userID }))
    })

    const colliderEntity = createEntity()
    setComponent(colliderEntity, NameComponent, 'item-collider')
    setComponent(colliderEntity, VisibleComponent, true)
    setComponent(colliderEntity, EntityTreeComponent, { parentEntity: entity })
    setComponent(colliderEntity, TransformComponent, { scale: new Vector3(0.25, 0.25, 0.25) })
    setComponent(colliderEntity, ColliderComponent, {
      shape: Shapes.Sphere,
      collisionLayer: CollisionGroups.Default,
      collisionMask: CollisionGroups.Avatars
    })
    setComponent(colliderEntity, PrimitiveGeometryComponent, {
      geometryType: GeometryTypeEnum.SphereGeometry
    })
    setComponent(colliderEntity, TriggerComponent, {
      triggers: [{ onEnter: 'onCollectItem', onExit: null, target: props.entityUUID }]
    })
    /** @todo change this to material definition component */
    // const material = getComponent(colliderEntity, MeshComponent).material as MeshStandardMaterial
    // material.color = new Color(getState(ItemState)[props.colliderUUID])
    setComponent(colliderEntity, ShadowComponent)
  }, [entity])

  return null
}

const ItemComponent = defineComponent({
  id: 'ir.example.ItemCollectGame.ItemComponent',
  name: 'ItemComponent'
})

const itemQuery = defineQuery([ItemComponent])

const ItemSpawnSystem = defineSystem({
  uuid: 'ir.example.ItemCollectGame.ItemSpawnSystem',
  insert: { with: SimulationSystemGroup },
  execute: () => {
    const itemEntities = itemQuery()
    if (itemEntities.length) return

    const worldNetwork = NetworkState.worldNetwork
    if (!worldNetwork?.isHosting) return

    const color = ValidItemColors[Math.floor(Math.random() * ValidItemColors.length)]

    /** @todo hack to get a reference to the default scene platform object */
    const platformEntity = NameComponent.entitiesByName['platform']?.[0]
    if (!platformEntity) return

    const rootSceneEntity = getAncestorWithComponents(platformEntity, [SceneComponent])
    const parentUUID = getComponent(rootSceneEntity, UUIDComponent)

    dispatchAction(
      ItemActions.spawn({
        parentUUID,
        entityUUID: UUIDComponent.generateUUID(),
        color,
        position: new Vector3(MathUtils.randFloat(-10, 10), 0.5, MathUtils.randFloat(-10, 10)),
        rotation: new Quaternion().random()
      })
    )
  }
})
